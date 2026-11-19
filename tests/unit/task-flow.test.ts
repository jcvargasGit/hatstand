// The pure rules behind creating and reviewing a task.
import { describe, expect, it } from 'vitest';
import { sendsOpeningByItself } from '../../src/main/sessions';
import { hasWork, repoWork } from '../../src/renderer/src/lib/agent-work';
import { choicesOf, newTaskChoices, orderGuidesByUse, suggestedArea, suggestedGuide } from '../../src/renderer/src/lib/task-form';
import { groupByGuide, NOT_CLASSIFIED, type TodayItem } from '../../src/renderer/src/lib/today';
import type { PlaybookSummary, RepoChanges, Snapshot } from '../../src/shared/api';
import { allStepsDone, canLeaveCurrentStep, isGuideStepDone, nextOpenStep, stepsDoneAhead } from '../../src/shared/guide-progress';
import { companySchema, taskSchema, type TaskGuide } from '../../src/shared/schemas';
import { taskRepositories } from '../../src/shared/work-repos';

const playbook = (id: string, name = id): PlaybookSummary => ({ id, name, steps: [{ name: 'a', prompt: 'b' }], origin: 'built-in' });
const company = companySchema.parse({
  id: 'acme',
  name: 'Acme',
  color: '#5BB8A6',
  defaultAreaId: 'core',
  subdomains: [{ id: 'core', name: 'Core' }, { id: 'pay', name: 'Payments', folders: [{ projectId: 'web', path: 'pay' }] }],
  projects: [{ id: 'api', name: 'api', path: '/code/api', subdomainId: 'pay' }, { id: 'web', name: 'web', path: '/code/web' }, { id: 'ops', name: 'ops', path: '/code/ops' }],
});
const snapshot = { companies: [company], accounts: { defaultAccountId: 'claude', accounts: [] }, guideNewTasks: true } as unknown as Snapshot;
const guide = (change: Partial<TaskGuide> = {}): TaskGuide => ({
  playbookId: 'backlog',
  name: 'Create tasks from requirements',
  current: 0,
  promptPending: false,
  done: [],
  steps: [{ name: 'Gather context', prompt: 'a' }, { name: 'Draft the tasks', prompt: 'b' }, { name: 'Create the tasks', prompt: 'c', approval: true }],
  ...change,
});

describe('the guides a new task offers', () => {
  it('puts the guides used most first, and keeps the rest in their order', () => {
    const guides = [playbook('implement'), playbook('pr-review'), playbook('bug'), playbook('rfc')];
    expect(orderGuidesByUse(guides, { bug: 3, rfc: 1 }).map((item) => item.id)).toEqual(['bug', 'rfc', 'implement', 'pr-review']);
    expect(orderGuidesByUse(guides, {}).map((item) => item.id)).toEqual(['implement', 'pr-review', 'bug', 'rfc']);
    expect(orderGuidesByUse(guides, { gone: 9, rfc: 2, bug: 2 }).map((item) => item.id)).toEqual(['bug', 'rfc', 'implement', 'pr-review']);
  });

  it('starts with the default guide of the client, else Implement a task when that setting is on', () => {
    const guides = [playbook('implement'), playbook('bug')];
    expect(suggestedGuide(snapshot, { ...company, defaultPlaybookId: 'bug' }, guides)).toBe('bug');
    expect(suggestedGuide(snapshot, company, guides)).toBe('implement');
    expect(suggestedGuide({ guideNewTasks: false }, company, guides)).toBe('');
    expect(suggestedGuide(snapshot, { ...company, defaultPlaybookId: 'gone' }, [])).toBe('');
  });
});

describe('the choices of a task', () => {
  it('start a new task with the area of its repositories and the default agent', () => {
    expect(newTaskChoices(snapshot, 'acme')).toEqual({ companyId: 'acme', playbookId: '', areaId: 'core', accountId: 'claude', priority: 'none', isolated: true, projectIds: [] });
    expect(newTaskChoices(snapshot, 'acme', 'pay')).toMatchObject({ areaId: 'pay', projectIds: ['api', 'web'] });
    expect(suggestedArea(company, ['api'])).toBe('pay');
    expect(suggestedArea(company, ['api', 'ops'])).toBe('core');
  });

  it('take over what an inbox item already has', () => {
    const task = taskSchema.parse({ id: 't', companyId: 'acme', title: 'T', status: 'idea', projectIds: ['ops'], priority: 'high', accountId: 'work', isolated: true, createdAt: 'x', updatedAt: 'x' });
    expect(choicesOf(task, snapshot)).toEqual({ companyId: 'acme', playbookId: '', areaId: 'core', accountId: 'work', priority: 'high', isolated: true, projectIds: ['ops'] });
  });

  it('include the repositories of the folders of the area', () => {
    expect(taskRepositories(company, { projectIds: ['ops'], subdomainId: 'pay' }).map((repo) => repo.id)).toEqual(['web', 'ops']);
  });
});

describe('the progress of a guide', () => {
  it('counts the steps the agent reported, in any order', () => {
    const reported = guide({ done: [2] });
    expect(isGuideStepDone(reported, 1)).toBe(true);
    expect(canLeaveCurrentStep(reported)).toBe(false);
    expect(stepsDoneAhead(reported)).toEqual([2]);
    expect(nextOpenStep(guide({ done: [1, 2] }))).toBe(2);
    expect(nextOpenStep(guide({ current: 2 }))).toBeNull();
    expect(allStepsDone(guide({ done: [1, 2, 3] }))).toBe(true);
  });

  it('lets the person leave a step that has nothing for the agent', () => {
    expect(canLeaveCurrentStep(guide({ steps: [{ name: 'Sign in', you: 'Sign in.' }, { name: 'b', prompt: 'b' }] }))).toBe(true);
  });
});

describe('the first session of a task', () => {
  it('sends its opening by itself, unless the step needs approval or is one the person does', () => {
    expect(sendsOpeningByItself({ guide: undefined })).toBe(true);
    expect(sendsOpeningByItself({ guide: guide() })).toBe(true);
    expect(sendsOpeningByItself({ guide: guide({ current: 2 }) })).toBe(false);
    expect(sendsOpeningByItself({ guide: guide({ steps: [{ name: 'Sign in', you: 'Sign in.' }] }) })).toBe(false);
  });
});

describe('the sidebar tree', () => {
  const item = (id: string, guideName?: string): TodayItem => ({
    company,
    task: taskSchema.parse({ id, companyId: 'acme', title: id, status: 'todo', createdAt: 'x', updatedAt: 'x', ...(guideName ? { guide: { ...guide(), playbookId: guideName, name: guideName } } : {}) }),
  });

  it('groups tasks by guide, guides by name, Not classified last, and keeps the order of the tasks', () => {
    const groups = groupByGuide([item('a'), item('b', 'Write an RFC'), item('c', 'Investigate a bug'), item('d', 'Write an RFC')]);
    expect(groups.map((group) => [group.name, group.items.map((entry) => entry.task.id)])).toEqual([
      ['Investigate a bug', ['c']],
      ['Write an RFC', ['b', 'd']],
      [NOT_CLASSIFIED, ['a']],
    ]);
    expect(groups.at(-1)?.name).toBe('Not classified');
    expect(groupByGuide([])).toEqual([]);
  });

  it('says which guide each group follows, and none for the tasks with no guide', () => {
    const groups = groupByGuide([item('a'), item('b', 'Write an RFC')]);
    expect(groups.map((group) => group.playbookId)).toEqual(['Write an RFC', '']);
  });

  it('keeps two guides with the same name apart, because the guide is what groups them', () => {
    const first = item('a', 'Write an RFC');
    const other = { ...item('b', 'Write an RFC'), task: { ...item('b', 'Write an RFC').task, guide: { ...guide(), playbookId: 'client-rfc', name: 'Write an RFC' } } };
    expect(groupByGuide([first, other]).map((group) => group.items.length)).toEqual([1, 1]);
  });
});

describe('what the agent panel shows', () => {
  it('sorts the files of the agent by what happened to them, once each', () => {
    const repo: RepoChanges = {
      projectId: 'api',
      name: 'api',
      path: '/c/api',
      isRepo: true,
      branch: 'hatstand/x',
      changes: [{ path: 'b.ts', status: 'modified' }, { path: 'new.ts', status: 'untracked' }],
      before: [{ path: 'old-edit.ts', status: 'modified' }],
      committed: [{ path: 'b.ts', status: 'added' }, { path: 'gone.ts', status: 'deleted' }, { path: 'moved.ts', status: 'renamed' }],
      commits: 1,
      truncated: false,
    };
    expect(repoWork(repo)).toEqual({ projectId: 'api', name: 'api', path: '/c/api', branch: 'hatstand/x', created: ['new.ts'], changed: ['b.ts', 'moved.ts'], deleted: ['gone.ts'], commits: 1 });
    expect(hasWork(repoWork({ ...repo, changes: [], committed: [], commits: 0 }))).toBe(false);
  });
});
