import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync as write } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { answerPlanCheck, backlogPromptInput, createBacklogPlanTask, planItemsOf, planJsonSchema, readPlanReport, savePlan, setPlanApproval } from '../../src/main/backlog-plan';
import { buildSystemPrompt, openingPrompt } from '../../src/main/agents/task-prompt';
import { githubCopilot } from '../../src/main/agents/github-copilot';
import { dataPaths, type DataPaths } from '../../src/main/paths';
import { Store } from '../../src/main/store';
import { checkBacklogPlan, parsePlanText, planItemName, type BacklogPlanInput, type PlanItem } from '../../src/shared/backlog-plan';
import type { Company, Task } from '../../src/shared/schemas';

const items: PlanItem[] = [
  { id: 'a', number: 1, title: 'Add the export' },
  { id: 'b', number: 2, title: 'Send it by email' },
  { id: 'c', number: 3, title: 'Pick a PDF library' },
];

const plan = (change: Partial<BacklogPlanInput> = {}): BacklogPlanInput => ({
  version: 1,
  summary: 'Export first, then email.',
  order: [
    { task: 1, reason: 'Everything else builds on it.' },
    { task: 2, reason: 'Needs the export.', dependsOn: [1] },
  ],
  notInParallel: [{ tasks: [1, 2], reason: 'Both change the report service.' }],
  outOfScope: [{ task: 3, decisionNeeded: 'Which PDF library is allowed?' }],
  ...change,
});

const writeFileSync = (file: string, text: string) => {
  mkdirSync(dirname(file), { recursive: true });
  write(file, text);
};

const problemsOf = (input: unknown, known = items) => {
  const check = checkBacklogPlan(input, known);
  return check.success ? [] : check.problems;
};

describe('the plan the assistant writes', () => {
  it('accepts an order with dependencies, groups that cannot run together, and tasks left for a decision', () => {
    const check = checkBacklogPlan(plan(), items);
    expect(check.success).toBe(true);
    if (check.success) expect(check.plan.order[0]?.dependsOn).toEqual([]);
  });

  it('needs every selected task, once', () => {
    expect(problemsOf(plan({ outOfScope: [] }))).toEqual(['#3 "Pick a PDF library" is missing. Put it in the order, or out of scope with the decision it needs.']);
    expect(problemsOf(plan({ outOfScope: [{ task: 1, decisionNeeded: 'Now?' }, { task: 3, decisionNeeded: 'Which?' }] }))).toContain(
      'outOfScope[0].task: #1 "Add the export" appears twice: in the order and in out of scope. Put each task in one place.',
    );
  });

  it('refuses a plan with no order', () => {
    const { order: _order, ...noOrder } = plan();
    expect(problemsOf(noOrder).some((problem) => problem.startsWith('order:'))).toBe(true);
  });

  it('refuses tasks that were not selected', () => {
    expect(problemsOf(plan({ order: [{ task: 1 }, { task: 2 }, { task: 99 }], notInParallel: [] }))).toContain('order[2].task: #99 is not one of the selected tasks.');
  });

  it('asks for task numbers written as numbers', () => {
    expect(problemsOf(plan({ order: [{ task: '#1' as never }, { task: 2, dependsOn: [1] }] }))).toEqual(['order[0].task: Write the task number as a number, such as 12, without #.']);
    expect(problemsOf(plan({ order: [{ task: 1.5 }, { task: 2 }] }))[0]).toBe('order[0].task: Write the task number as a whole number, such as 12.');
  });

  it('puts a task after the tasks it depends on', () => {
    const backwards = plan({ order: [{ task: 2, dependsOn: [1] }, { task: 1 }] });
    expect(problemsOf(backwards)).toEqual(['order[0].dependsOn[0]: #2 "Send it by email" depends on #1 "Add the export", so #1 "Add the export" has to come first in the order.']);
    expect(problemsOf(plan({ order: [{ task: 1, dependsOn: [1] }, { task: 2 }] }))).toEqual(['order[0].dependsOn[0]: #1 "Add the export" cannot depend on itself.']);
  });

  it('asks to leave out a task that waits on one left for a decision', () => {
    const waiting = plan({ order: [{ task: 1 }, { task: 2, dependsOn: [3] }] });
    expect(problemsOf(waiting)[0]).toMatch(/depends on #3 "Pick a PDF library", which waits for a decision\. Move #2 "Send it by email" out of scope too/);
  });

  it('needs two planned tasks and a reason for each group that cannot run together', () => {
    expect(problemsOf(plan({ notInParallel: [{ tasks: [1], reason: 'x' }] }))[0]).toMatch(/at least two tasks/);
    expect(problemsOf(plan({ notInParallel: [{ tasks: [1, 2], reason: ' ' }] }))[0]).toMatch(/Say why/);
    expect(problemsOf(plan({ notInParallel: [{ tasks: [1, 3], reason: 'Same table.' }] }))).toEqual([
      'notInParallel[0].tasks[1]: #3 "Pick a PDF library" is in a group that cannot run at the same time, but it is not in the order.',
    ]);
  });

  it('needs the decision the person has to make', () => {
    expect(problemsOf(plan({ outOfScope: [{ task: 3, decisionNeeded: '' }] }))).toEqual(['outOfScope[0].decisionNeeded: Write the decision the person has to make.']);
  });

  it('explains a file that is not JSON or has the wrong shape', () => {
    expect(parsePlanText('{ nope', items)).toMatchObject({ success: false, problems: [expect.stringMatching(/^This is not valid JSON\./)] });
    expect(problemsOf({ version: 2, order: 'a' })).toEqual(expect.arrayContaining([expect.stringMatching(/^version:/), expect.stringMatching(/^order:/)]));
  });

  it('does not ask for a task deleted after it was selected, and still accepts it', () => {
    const gone = items.map((item) => (item.id === 'c' ? { ...item, deleted: true } : item));
    expect(problemsOf(plan({ outOfScope: [] }), gone)).toEqual([]);
    expect(problemsOf(plan(), gone)).toEqual([]);
  });

  it('describes its shape as JSON Schema for the assistant', () => {
    const schema = JSON.parse(planJsonSchema());
    expect(schema.required).toEqual(['version', 'order']);
    expect(Object.keys(schema.properties)).toEqual(['version', 'summary', 'order', 'notInParallel', 'outOfScope']);
    expect(schema.properties.order.items.properties.dependsOn.description).toMatch(/earlier in the order/);
    expect(schema.properties.order.items.properties.task).toMatchObject({ type: 'integer', description: expect.stringContaining('12 for #12') });
  });
});

describe('a planning task for the backlog', () => {
  let dir: string;
  let paths: DataPaths;
  let store: Store;
  let inbox: Task[];

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-plan-')));
    paths = dataPaths(join(dir, 'home'));
    store = new Store(paths);
    store.createCompany('Acme', '#112233');
    store.createCompany('Other', '#445566');
    inbox = ['Add the export', 'Send it by email', 'Pick a PDF library'].map((title) => store.createTask({ companyId: 'acme', title }, undefined, 'idea'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const ids = () => inbox.map((task) => task.id);
  const validPlan = (): BacklogPlanInput => ({
    version: 1,
    order: [{ task: 1 }, { task: 2, dependsOn: [1] }],
    outOfScope: [{ task: 3, decisionNeeded: 'Which library?' }],
  });

  it('creates a planning task that keeps the selection and leaves the inbox as it was', () => {
    const task = createBacklogPlanTask(store, 'acme', ids());
    expect(task).toMatchObject({ title: 'Plan the backlog: 3 tasks', type: 'planning', status: 'todo', backlogPlan: { items: ids().map((id, index) => ({ id, number: index + 1 })) } });
    expect(task.description).toContain('- #1 Add the export');
    expect(task.description).toMatch(/does not change code/);
    expect(store.listTasks('acme').filter((item) => item.status === 'idea')).toHaveLength(3);
  });

  it('refuses an empty selection, tasks of another client and tasks that left the inbox', () => {
    expect(() => createBacklogPlanTask(store, 'acme', [])).toThrow(/Select at least one task/);
    expect(() => createBacklogPlanTask(store, 'other', ids())).toThrow(/no longer in this client's inbox/);
    const [first] = inbox as [Task];
    store.updateTask(first.id, { status: 'todo' });
    expect(() => createBacklogPlanTask(store, 'acme', ids())).toThrow(/"Add the export" is no longer in the inbox/);
  });

  it('cannot get a selection or an approval through an ordinary task change', () => {
    const task = createBacklogPlanTask(store, 'acme', ids());
    const forged = { backlogPlan: { items: [{ id: 'x', number: 9 }], approval: { approvedAt: 'now', digest: 'x' } } };
    store.updateTask(task.id, forged as never);
    expect(store.findTask(task.id).backlogPlan).toEqual({ items: ids().map((id, index) => ({ id, number: index + 1 })) });
  });

  it('reports a missing plan, a plan to fix and a valid one', () => {
    const task = createBacklogPlanTask(store, 'acme', ids());
    expect(readPlanReport(store, paths, task)).toEqual({ state: 'missing' });
    writeFileSync(paths.planFile('acme', task.id), JSON.stringify({ version: 1, order: [] }));
    const invalid = readPlanReport(store, paths, task);
    expect(invalid.state).toBe('invalid');
    writeFileSync(paths.planFile('acme', task.id), JSON.stringify(validPlan()));
    expect(readPlanReport(store, paths, task)).toMatchObject({ state: 'valid', approvedAt: null, changedAfterApproval: false });
  });

  it('records an approval for this exact plan, and drops it when the plan changes', () => {
    const task = createBacklogPlanTask(store, 'acme', ids());
    expect(() => setPlanApproval(store, paths, task.id, true)).toThrow(/no plan to approve/);
    writeFileSync(paths.planFile('acme', task.id), JSON.stringify(validPlan()));
    const approved = setPlanApproval(store, paths, task.id, true);
    expect(approved).toMatchObject({ state: 'valid', approvedAt: expect.any(String) });
    expect(store.findTask(task.id).status).toBe('todo');

    writeFileSync(paths.planFile('acme', task.id), JSON.stringify({ ...validPlan(), summary: 'Changed by the assistant.' }));
    expect(readPlanReport(store, paths, store.findTask(task.id))).toMatchObject({ approvedAt: null, changedAfterApproval: true });

    setPlanApproval(store, paths, task.id, true);
    expect(setPlanApproval(store, paths, task.id, false)).toMatchObject({ approvedAt: null, changedAfterApproval: false });
  });

  it('starts no session and leaves the planned tasks as they were when the plan is approved', () => {
    const task = createBacklogPlanTask(store, 'acme', ids());
    writeFileSync(paths.planFile('acme', task.id), JSON.stringify(validPlan()));
    const before = store.listTasks('acme').filter((item) => ids().includes(item.id));
    setPlanApproval(store, paths, task.id, true);
    expect(store.listSessions()).toEqual([]);
    expect(store.listTasks('acme').filter((item) => ids().includes(item.id))).toEqual(before);
    expect(store.findTask(task.id).status).toBe('todo');
  });

  it('does not approve a plan that fails the check', () => {
    const task = createBacklogPlanTask(store, 'acme', ids());
    writeFileSync(paths.planFile('acme', task.id), '{}');
    expect(() => setPlanApproval(store, paths, task.id, true)).toThrow(/Fix the plan/);
  });

  it('saves the edits of the person only when they pass the check, and asks for a new approval', () => {
    const task = createBacklogPlanTask(store, 'acme', ids());
    writeFileSync(paths.planFile('acme', task.id), JSON.stringify(validPlan()));
    setPlanApproval(store, paths, task.id, true);
    expect(() => savePlan(store, paths, task.id, { ...validPlan(), order: [{ task: 2, dependsOn: [1] }, { task: 1 }] })).toThrow(/The plan was not saved\..*has to come first/);

    const report = savePlan(store, paths, task.id, { ...validPlan(), summary: 'Mine.' });
    expect(report).toMatchObject({ state: 'valid', approvedAt: null, changedAfterApproval: false, plan: { summary: 'Mine.' } });
    expect(JSON.parse(readFileSync(paths.planFile('acme', task.id), 'utf8'))).toMatchObject({ version: 1, summary: 'Mine.', notInParallel: [] });
  });

  it('still knows a task by its number after it is deleted from the inbox', () => {
    const task = createBacklogPlanTask(store, 'acme', ids());
    writeFileSync(paths.planFile('acme', task.id), JSON.stringify(validPlan()));
    store.deleteTask((inbox[2] as Task).id);
    expect(readPlanReport(store, paths, store.findTask(task.id)).state).toBe('valid');
    expect(savePlan(store, paths, task.id, { ...validPlan(), outOfScope: [] }).state).toBe('valid');
    expect(planItemName(planItemsOf(store, store.findTask(task.id)), 3)).toBe('#3 (deleted)');
  });

  it('answers the check the assistant runs', () => {
    const task = createBacklogPlanTask(store, 'acme', ids());
    expect(answerPlanCheck(store, paths, task.id)).toEqual({ ok: false, text: expect.stringContaining('There is no plan yet. Write it to') });
    writeFileSync(paths.planFile('acme', task.id), JSON.stringify({ version: 1, order: [] }));
    const failing = answerPlanCheck(store, paths, task.id);
    expect(failing.ok).toBe(false);
    expect(failing.text).toMatch(/- #1 "Add the export" is missing/);
    writeFileSync(paths.planFile('acme', task.id), JSON.stringify(validPlan()));
    expect(answerPlanCheck(store, paths, task.id)).toEqual({
      ok: true,
      text: expect.stringContaining('The plan is valid: 2 in the order, 0 group(s) that cannot run at the same time, 1 out of scope. Left for the person to decide: #3 "Pick a PDF library".'),
    });
  });

  it('keeps the plan apart from the tasks, and deletes it with its task', () => {
    const task = createBacklogPlanTask(store, 'acme', ids());
    writeFileSync(paths.planFile('acme', task.id), JSON.stringify(validPlan()));
    expect(store.listTasks('acme')).toHaveLength(4);
    store.deleteTask(task.id);
    expect(existsSync(paths.planFile('acme', task.id))).toBe(false);
  });

  describe('what the assistant is told', () => {
    const promptFor = (company: Company, task: Task) =>
      buildSystemPrompt({
        company,
        task,
        repositories: company.projects,
        companyInstructions: '',
        knowledgeDirs: [],
        planning: company.planning ? { ...company.planning, hasGit: true } : undefined,
        notesFile: '/notes/t.md',
        notes: '',
        backlog: backlogPromptInput(store, paths, task),
      });

    it('lists the selected tasks with their ids and details, where to write the plan, and how to check it', () => {
      const [first] = inbox as [Task];
      store.updateTask(first.id, { description: 'CSV for the labs.', priority: 'high' });
      const task = createBacklogPlanTask(store, 'acme', ids());
      const prompt = promptFor(store.readCompany('acme'), task);
      expect(prompt).toContain('### #1 Add the export (priority high)');
      expect(prompt).not.toContain(first.id);
      expect(prompt).toContain('Refer to each task by its number, written as a JSON number: 12 for #12.');
      expect(prompt).toContain('CSV for the labs.');
      expect(prompt).toContain(`Write the plan as JSON to ${paths.planFile('acme', task.id)}.`);
      expect(prompt).toContain('run hatstand-check-plan');
      expect(prompt).toContain('"notInParallel"');
      expect(prompt).toMatch(/approving it does not start any work/);
    });

    it('keeps it away from changing code and from committing the plan', () => {
      const company: Company = {
        ...store.readCompany('acme'),
        projects: [{ id: 'api', name: 'api', path: '/code/api' }],
        planning: { path: '/code/specs', places: [] },
      };
      const task = createBacklogPlanTask(store, 'acme', ids());
      const prompt = promptFor(company, task);
      expect(prompt).toContain('## This task does not change code');
      expect(prompt).toContain('api (/code/api)');
      expect(prompt).not.toContain('hatstand-edit-repo');
      expect(prompt).not.toMatch(/Commit the result of this task/);
      expect(prompt).toContain('The plan of this task is not saved there.');
    });

    it('suggests reading the tasks and writing the plan as the first prompt', () => {
      const task = createBacklogPlanTask(store, 'acme', ids());
      expect(openingPrompt(task, [], false)).toMatch(/^Read the 3 inbox tasks listed in your instructions.*hatstand-check-plan\. Do not change any code\.$/);
      expect(openingPrompt(task, [], true)).toBeNull();
    });

    it('lets Copilot run the check without asking, only in a planning task', () => {
      const task = createBacklogPlanTask(store, 'acme', ids());
      const launch = (forTask: Task) =>
        githubCopilot.buildLaunch({
          account: { id: 'c', name: 'Copilot', type: 'github-copilot', label: 'personal' },
          company: store.readCompany('acme'),
          task: forTask,
          sessionId: 's',
          sessionDir: join(dir, 's'),
          notesFile: '/notes/t.md',
          resume: false,
          promptFile: '/p',
          settingsFile: '/s',
          addDirs: [],
        }).args;
      expect(launch(task)).toContain('--allow-tool=shell(hatstand-check-plan:*)');
      expect(launch(inbox[0] as Task)).not.toContain('--allow-tool=shell(hatstand-check-plan:*)');
    });
  });
});
