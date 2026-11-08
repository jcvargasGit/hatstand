import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { plainText, PromptPrefill, singleLine } from '../../src/main/agents/prompt-prefill';
import { endRunningSubagents, parseSubagentActivity, SESSION_RESTART_LINE } from '../../src/main/agents/subagent-activity';
import { buildInitialPrompt, buildStepPrompt, buildSystemPrompt, openingPrompt } from '../../src/main/agents/task-prompt';
import { claudeCode } from '../../src/main/agents/claude-code';
import { createPlaybook, customizePlaybook, findPlaybook, listPlaybooks, parsePlaybook, removePlaybook, startGuide } from '../../src/main/playbooks';
import { BUILTIN_PLAYBOOKS } from '../../src/main/builtin-playbooks';
import { listClientFiles, readClientFile } from '../../src/main/client-files';
import { dataPaths } from '../../src/main/paths';
import { Store, writePrivateFile } from '../../src/main/store';
import { removeClient } from '../../src/main/client-removal';
import { installPreCommitHook } from '../../src/main/guard/install';
import { defaultClientFolder, reposOutside, resolveWorkingDir } from '../../src/main/task-folders';
import type { Company, Task } from '../../src/shared/schemas';

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-task-')));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('PromptPrefill', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('types the prompt once, after the agent goes quiet, with no Enter', () => {
    const write = vi.fn();
    const prefill = new PromptPrefill('Review the task', write);
    prefill.onOutput('Welcome');
    vi.advanceTimersByTime(300);
    prefill.onOutput(' to the agent');
    vi.advanceTimersByTime(500);
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(write).toHaveBeenCalledExactlyOnceWith('Review the task');
    prefill.onOutput('more');
    vi.advanceTimersByTime(20_000);
    expect(write).toHaveBeenCalledOnce();
  });

  it('does not wait forever for an agent that keeps drawing', () => {
    const write = vi.fn();
    const prefill = new PromptPrefill('Go', write);
    for (let tick = 0; tick < 40; tick += 1) {
      prefill.onOutput('spinner');
      vi.advanceTimersByTime(500);
    }
    expect(write).toHaveBeenCalledOnce();
  });

  it('waits behind a trust question until the person answers it', () => {
    const write = vi.fn();
    const prefill = new PromptPrefill('Go', write);
    prefill.onOutput('Do you \x1b[1mtrust the files\x1b[0m in this folder?');
    vi.advanceTimersByTime(60_000);
    expect(write).not.toHaveBeenCalled();

    prefill.onInput('\x1b[B');
    prefill.onOutput('Yes, I trust this folder');
    vi.advanceTimersByTime(60_000);
    expect(write).not.toHaveBeenCalled();

    prefill.onInput('\r');
    prefill.onOutput('Is this one you trust? Yes, I trust this folder');
    vi.advanceTimersByTime(300);
    prefill.onOutput('Welcome back');
    vi.advanceTimersByTime(800);
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(800);
    expect(write).toHaveBeenCalledExactlyOnceWith('Go');
  });

  it('recognizes a trust question drawn with cursor moves instead of spaces', () => {
    const write = vi.fn();
    const prefill = new PromptPrefill('Go', write);
    prefill.onOutput('No,\x1b[1Cexit Yes,\x1b[1CI\x1b[1Ctrust\x1b[1Cthis\x1b[1Cfolder');
    vi.advanceTimersByTime(60_000);
    expect(write).not.toHaveBeenCalled();
  });

  it('accepts an answer given before the agent goes quiet', () => {
    const write = vi.fn();
    const prefill = new PromptPrefill('Go', write);
    prefill.onOutput('Yes, I trust this folder');
    vi.advanceTimersByTime(100);
    prefill.onInput('\r');
    vi.advanceTimersByTime(3000);
    expect(write).toHaveBeenCalledExactlyOnceWith('Go');
  });

  it('ignores Enter when no trust question is showing', () => {
    const write = vi.fn();
    const prefill = new PromptPrefill('Go', write);
    prefill.onOutput('Welcome');
    prefill.onInput('\r');
    vi.advanceTimersByTime(800);
    expect(write).toHaveBeenCalledExactlyOnceWith('Go');
  });

  it('writes nothing after the session ends', () => {
    const write = vi.fn();
    const prefill = new PromptPrefill('Go', write);
    prefill.onOutput('hello');
    prefill.cancel();
    vi.advanceTimersByTime(60_000);
    expect(write).not.toHaveBeenCalled();
  });
});

describe('the suggested prompt', () => {
  const task = { title: 'Fix it', projectIds: [] } as unknown as Task;
  const repo = (name: string) => ({ id: name, name, path: `/${name}` });

  it('names the chosen repositories', () => {
    expect(buildInitialPrompt(task, ['api', 'web'])).toContain('Focus on api, web.');
    expect(buildInitialPrompt(task, [])).not.toContain('Focus on');
  });

  it('cannot press Enter or send escape codes from an imported title', () => {
    const prompt = buildInitialPrompt({ ...task, title: 'Bad\rtitle\n\x1b[31mred\x03' }, []);
    expect(prompt).not.toMatch(/[\x00-\x1f]/);
    expect(prompt).toContain('Bad title');
  });

  it('cleans text', () => {
    expect(singleLine(' a\r\n\tb ')).toBe('a b');
    expect(plainText('\x1b[1mbold\x1b[0m')).toBe('bold');
  });
});

describe('where a session opens', () => {
  const company = (overrides: Partial<Company>): Company => ({
    id: 'a',
    name: 'A',
    color: '#112233',
    origin: 'existing',
    hasCode: true, confirmedSteps: [],
    skipPermissions: false,
    protectedPaths: [], links: [],
    subdomains: [],
    projects: [],
    context: {},
    ...overrides,
  });
  const task = (projectIds: string[]) => ({ projectIds }) as unknown as Task;

  it('opens in the client folder even with repositories chosen', () => {
    const repo = { id: 'r', name: 'r', path: join(dir, 'r') };
    mkdirSync(repo.path);
    expect(resolveWorkingDir(company({ rootDir: dir, projects: [repo] }), task(['r']))).toBe(dir);
  });

  it('opens in the first chosen repository when there is no client folder', () => {
    const one = { id: '1', name: '1', path: join(dir, '1') };
    const two = { id: '2', name: '2', path: join(dir, '2') };
    mkdirSync(one.path);
    mkdirSync(two.path);
    expect(resolveWorkingDir(company({ projects: [one, two] }), task(['2']))).toBe(two.path);
  });

  it('gives access only to chosen repositories outside the folder', () => {
    const inside = { id: '1', name: '1', path: '/code/a' };
    const similar = { id: '2', name: '2', path: '/code-old/b' };
    expect(reposOutside('/code', [inside, similar])).toEqual(['/code-old/b']);
    expect(reposOutside('/code', [{ ...inside, path: '/code' }])).toEqual([]);
  });
});

describe('Store tasks', () => {
  const setup = () => {
    const paths = dataPaths(join(dir, 'home'));
    const store = new Store(paths);
    store.createCompany('Acme', '#112233');
    return { paths, store };
  };

  it('reads a task saved with a single project', () => {
    const { paths, store } = setup();
    writePrivateFile(
      paths.taskFile('acme', 'old'),
      JSON.stringify({ id: 'old', companyId: 'acme', title: 'Old', description: '', status: 'todo', projectId: 'api', createdAt: 'x', updatedAt: 'x' }),
    );
    expect(store.findTask('old').projectIds).toEqual(['api']);
  });

  it('keeps every other field when one changes', () => {
    const { store } = setup();
    const { id } = store.createTask({ companyId: 'acme', title: 'Keep', description: 'Why it matters', projectIds: ['a', 'b'] });
    store.updateTask(id, { status: 'done' });
    expect(store.findTask(id)).toMatchObject({ status: 'done', description: 'Why it matters', projectIds: ['a', 'b'] });
  });

  it('archives and restores', () => {
    const { store } = setup();
    const { id } = store.createTask({ companyId: 'acme', title: 'Keep', projectIds: ['a', 'b'] });
    expect(store.findTask(id).projectIds).toEqual(['a', 'b']);
    store.updateTask(id, { archivedAt: '2026-01-01' });
    expect(store.findTask(id).archivedAt).toBe('2026-01-01');
    store.updateTask(id, { archivedAt: undefined });
    expect(store.findTask(id).archivedAt).toBeUndefined();
  });

  it('deletes a task with its notes and sessions, and nothing else', () => {
    const { paths, store } = setup();
    const gone = store.createTask({ companyId: 'acme', title: 'Gone' });
    const kept = store.createTask({ companyId: 'acme', title: 'Kept' });
    store.writeNotes(gone, 'notes');
    const session = (id: string, taskId: string) => ({
      id,
      taskId,
      companyId: 'acme',
      accountId: 'c',
      cwd: '/',
      state: 'stopped' as const,
      startedAt: 'x',
      updatedAt: 'x',
    });
    store.saveSession(session('00000000-0000-4000-8000-000000000001', gone.id));
    store.saveSession(session('00000000-0000-4000-8000-000000000002', kept.id));

    store.deleteTask(gone.id);

    expect(store.listTasks('acme').map((task) => task.title)).toEqual(['Kept']);
    expect(existsSync(paths.notesFile('acme', gone.id))).toBe(false);
    expect(store.listSessions().map((item) => item.taskId)).toEqual([kept.id]);
  });
});

describe('client files', () => {
  const setup = () => {
    const paths = dataPaths(join(dir, 'home'));
    const store = new Store(paths);
    const outside = join(dir, 'outside');
    const extra = join(dir, 'extra');
    mkdirSync(outside);
    mkdirSync(join(extra, '.git'), { recursive: true });
    writeFileSync(join(outside, 'secret.md'), 'not for this client');
    writeFileSync(join(extra, 'guide.md'), 'guide');
    writeFileSync(join(extra, '.git', 'config.md'), 'hidden');
    writeFileSync(join(extra, 'photo.png'), 'binary');
    const instructions = join(dir, 'rules.md');
    writeFileSync(instructions, 'rules');
    const base = store.createCompany('Acme', '#112233');
    const company: Company = { ...base, context: { ...base.context, instructionsFile: instructions, knowledgeDir: extra } };
    mkdirSync(join(paths.skillsDir('acme'), 'deploy'), { recursive: true });
    writeFileSync(join(paths.skillsDir('acme'), 'deploy', 'SKILL.md'), 'skill');
    return { paths, company, outside, extra, instructions };
  };

  it('lists text files by scope, without hidden folders or binaries', () => {
    const { paths, company } = setup();
    const names = listClientFiles(paths, company).map((file) => [file.scope, file.name]);
    expect(names).toEqual([
      ['llm-config', 'rules.md'],
      ['llm-config', join('skills', 'deploy', 'SKILL.md')],
      ['knowledge', 'guide.md'],
      ['areas', 'Instructions.md'],
      ['areas', 'Notes.md'],
      ['areas', 'Tips.md'],
    ]);
  });

  it('refuses files outside this client, including through a link or a parent path', () => {
    const { paths, company, outside, extra } = setup();
    const secret = join(outside, 'secret.md');
    expect(() => readClientFile(paths, company, secret)).toThrow(/not a file of this client/);
    expect(() => readClientFile(paths, company, join(extra, '..', 'outside', 'secret.md'))).toThrow(/not a file of this client/);
    symlinkSync(secret, join(extra, 'link.md'));
    expect(() => readClientFile(paths, company, join(extra, 'link.md'))).toThrow(/not a file of this client/);
    symlinkSync(outside, join(extra, 'linked-folder'));
    expect(() => readClientFile(paths, company, join(extra, 'linked-folder', 'secret.md'))).toThrow(/not a file of this client/);
    expect(listClientFiles(paths, company).some((file) => file.path.includes('secret'))).toBe(false);
  });

  it('refuses a binary file inside a client folder', () => {
    const { paths, company, extra } = setup();
    expect(() => readClientFile(paths, company, join(extra, 'photo.png'))).toThrow(/not a file of this client/);
  });
});

describe('PromptPrefill with a guide', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('types the newest step when the person moves on before it was typed', () => {
    const write = vi.fn();
    const prefill = new PromptPrefill('One', write);
    prefill.onOutput('hello');
    prefill.retarget('Two');
    vi.advanceTimersByTime(800);
    expect(write).toHaveBeenCalledExactlyOnceWith('Two');
    expect(prefill.isWaiting).toBe(false);
  });

  it('types nothing when the newest step belongs to the person', () => {
    const write = vi.fn();
    const prefill = new PromptPrefill('One', write);
    prefill.onOutput('hello');
    prefill.retarget(null);
    vi.advanceTimersByTime(20_000);
    expect(write).not.toHaveBeenCalled();
  });
});

describe('guide prompts', () => {
  const guide = {
    playbookId: 'x',
    name: 'Check',
    current: 0,
    promptPending: true,
    steps: [{ name: 'Read', prompt: 'Read {ticket} at {link} about {task}.' }, { name: 'Sign in', you: 'Sign in.' }, { name: 'Post', approval: true, prompt: 'Post it.' }],
  };
  const task = (overrides = {}) => ({ id: 't', title: 'Fix it', projectIds: [], checklist: [], guide, ...overrides }) as unknown as Task;
  const repo = { id: 'api', name: 'api', path: '/api' };

  it('fills in the task, and names the step and the repositories', () => {
    const prompt = buildStepPrompt(task({ source: { kind: 'jira', key: 'ACME-1', url: 'https://x/ACME-1' } }), [repo.name]);
    expect(prompt).toBe('Step 1 of 3, Read: Read ACME-1 at https://x/ACME-1 about Fix it. Focus on api.');
  });

  it('cannot press Enter from a guide file or a title, and does not expand placeholders inside a title', () => {
    const prompt = buildStepPrompt(task({ title: 'Bad {ticket}\rtitle\n' }), []);
    expect(prompt).not.toMatch(/[\x00-\x1f]/);
    expect(prompt).toContain('about Bad {ticket} title');
  });

  it('types nothing for a step the person does', () => {
    expect(buildStepPrompt(task({ guide: { ...guide, current: 1 } }), [])).toBeNull();
  });

  it('types on start, and on resume only when a step was left waiting', () => {
    expect(openingPrompt(task(), [], false)).toContain('Step 1 of 3');
    expect(openingPrompt(task(), [], true)).toContain('Step 1 of 3');
    expect(openingPrompt(task({ guide: { ...guide, promptPending: false } }), [], true)).toBeNull();
    expect(openingPrompt(task({ guide: undefined }), [], true)).toBeNull();
    expect(openingPrompt(task({ guide: undefined }), [], false)).toContain('Review the task');
  });

  it('tells the agent to do one step and to wait for approval', () => {
    const prompt = buildSystemPrompt({
      company: { name: "Acme", links: [], projects: [] } as unknown as Company,
      task: task({ description: '' }),
      repositories: [],
      companyInstructions: '',
      knowledgeDirs: [],
      notesFile: '/n',
      notes: '',
    });
    expect(prompt).toContain('3. Post (needs approval)');
    expect(prompt).toContain('2. Sign in (the person does this)');
    expect(prompt).toContain('Do only the step you receive');
    expect(prompt).toContain('hatstand-step-done N');
    expect(prompt).toContain('Do not run it if you are midway');
  });
});

describe('guide files', () => {
  const setup = () => dataPaths(join(dir, 'home'));

  it('starts with the built-in guides, all valid', () => {
    const { playbooks, problems } = listPlaybooks(setup(), 'acme');
    expect(problems).toEqual([]);
    expect(playbooks.map((item) => item.id).sort()).toEqual(Object.keys(BUILTIN_PLAYBOOKS).sort());
    expect(playbooks.every((item) => item.origin === 'built-in')).toBe(true);
    for (const playbook of Object.values(BUILTIN_PLAYBOOKS)) {
      for (const step of playbook.steps.filter((item) => item.prompt && !item.approval)) {
        expect(step.prompt).toMatch(/Do not|Propose|do not/);
      }
    }
  });

  it('every guide that reaches outside the computer asks for approval first', () => {
    for (const id of ['implement', 'pr-review', 'bug', 'backlog', 'rfc']) {
      expect(BUILTIN_PLAYBOOKS[id]?.steps.some((step) => step.approval)).toBe(true);
    }
  });

  it('customizes a copy for one client only, and resets it', () => {
    const paths = setup();
    customizePlaybook(paths, 'acme', 'bug');
    const file = join(paths.playbooksDir('acme'), 'bug.yaml');
    writeFileSync(file, readFileSync(file, 'utf8').replace('Investigate a bug', 'Acme bugs'));
    expect(findPlaybook(paths, 'acme', 'bug')).toMatchObject({ name: 'Acme bugs', origin: 'customized', file });
    expect(findPlaybook(paths, 'other', 'bug')).toMatchObject({ name: 'Investigate a bug', origin: 'built-in' });
    expect(() => customizePlaybook(paths, 'acme', 'bug')).toThrow(/already/);
    removePlaybook(paths, 'acme', 'bug');
    expect(findPlaybook(paths, 'acme', 'bug').origin).toBe('built-in');
    expect(() => removePlaybook(paths, 'acme', 'bug')).toThrow(/cannot be removed/);
  });

  it('creates a new guide that is valid, with a safe file name', () => {
    const paths = setup();
    createPlaybook(paths, 'acme', ' ../Release: notes! ');
    expect(findPlaybook(paths, 'acme', 'release-notes')).toMatchObject({ name: '../Release: notes!', origin: 'client' });
    expect(existsSync(join(paths.playbooksDir('acme'), 'release-notes.yaml'))).toBe(true);
    expect(() => createPlaybook(paths, 'acme', '!!!')).toThrow(/at least one letter/);
    expect(() => createPlaybook(paths, 'acme', 'bug')).toThrow(/built-in/);
  });

  it('reports a broken file and keeps the others', () => {
    const paths = setup();
    mkdirSync(paths.playbooksDir('acme'), { recursive: true });
    writeFileSync(join(paths.playbooksDir('acme'), 'broken.yaml'), 'name: Broken\nsteps: []\n');
    writeFileSync(join(paths.playbooksDir('acme'), 'notes.txt'), 'not a guide');
    const { playbooks, problems } = listPlaybooks(paths, 'acme');
    expect(problems).toEqual(['broken.yaml: steps: A guide needs at least one step.']);
    expect(playbooks.some((item) => item.id === 'broken')).toBe(false);
  });

  it('explains what is wrong with a guide', () => {
    expect(() => parsePlaybook('name: [')).toThrow(/not valid YAML/);
    expect(() => parsePlaybook('name: X\nsteps:\n  - name: A\n')).toThrow(/either a prompt/);
    expect(() => parsePlaybook('name: X\nsteps:\n  - name: A\n    prompt: a\n    you: b\n')).toThrow(/either a prompt/);
  });

  it('gives a task its own copy of the steps', () => {
    const paths = setup();
    const store = new Store(paths);
    store.createCompany('Acme', '#112233');
    const created = store.createTask({ companyId: 'acme', title: 'Keep' });
    const guide = startGuide(findPlaybook(paths, 'acme', 'bug'));
    store.updateTask(created.id, { guide });
    customizePlaybook(paths, 'acme', 'bug');
    removePlaybook(paths, 'acme', 'bug');
    expect(store.findTask(created.id).guide).toEqual(guide);
    store.updateTask(created.id, { guide: undefined });
    expect(store.findTask(created.id).guide).toBeUndefined();
  });

  it('carries the type a guide declares to the task, and rejects an unknown one', () => {
    const own = parsePlaybook('name: X\ntype: report\nsteps:\n  - name: A\n    prompt: a\n');
    expect(startGuide({ ...own, id: 'x', origin: 'client' }).type).toBe('report');
    expect(() => parsePlaybook('name: X\ntype: other\nsteps:\n  - name: A\n    prompt: a\n')).toThrow(/^type:/);
  });

  it('forgets a saved type, so the next guide decides', () => {
    const store = new Store(setup());
    store.createCompany('Acme', '#112233');
    const { id } = store.createTask({ companyId: 'acme', title: 'Keep' });
    store.updateTask(id, { type: 'report' });
    store.updateTask(id, { type: undefined });
    expect(store.findTask(id).type).toBeUndefined();
  });

  it('lists guide files for editing, under their own scope', () => {
    const paths = setup();
    const store = new Store(paths);
    const company = store.createCompany('Acme', '#112233');
    customizePlaybook(paths, 'acme', 'rfc');
    const file = listClientFiles(paths, company).find((item) => item.scope === 'guides');
    expect(file?.name).toBe('rfc.yaml');
    expect(readClientFile(paths, company, join(paths.playbooksDir('acme'), 'rfc.yaml')).content).toContain('RFC');
  });
});

describe('subagent activity', () => {
  const line = (event: object) => JSON.stringify(event);
  const asked = (subagent_type: string, description: string) => line({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type, description, prompt: 'secret detail' } });
  const started = (id: string, type: string) => line({ hook_event_name: 'SubagentStart', agent_id: id, agent_type: type });
  const stopped = (id: string, type: string, text: string) => line({ hook_event_name: 'SubagentStop', agent_id: id, agent_type: type, last_assistant_message: text });

  it('follows a subagent from request to result', () => {
    const text = [asked('Explore', 'Find login'), started('a', 'Explore'), asked('Plan', 'Plan fix'), started('b', 'Plan'), stopped('a', 'Explore', 'Found it')].join('\n');
    expect(parseSubagentActivity(text)).toEqual([
      { id: 'a', type: 'Explore', description: 'Find login', state: 'finished', summary: 'Found it' },
      { id: 'b', type: 'Plan', description: 'Plan fix', state: 'running' },
    ]);
  });

  it('leaves out the agent’s own internal helpers, which have no type', () => {
    expect(parseSubagentActivity(stopped('x', '', 'Internal text'))).toEqual([]);
  });

  it('skips a damaged line and keeps the rest', () => {
    expect(parseSubagentActivity(['{not json', '"text"', started('a', 'Explore')].join('\n'))).toEqual([{ id: 'a', type: 'Explore', description: '', state: 'running' }]);
  });

  it('does not show a subagent from before a resume as running', () => {
    const text = `${started('a', 'Explore')}\n${SESSION_RESTART_LINE}${started('b', 'Plan')}`;
    expect(parseSubagentActivity(text).map((run) => run.state)).toEqual(['stopped', 'running']);
  });

  it('marks running subagents as stopped when the session ends', () => {
    const [run] = endRunningSubagents(parseSubagentActivity(started('a', 'Explore')));
    expect(run?.state).toBe('stopped');
  });

  it('asks Claude Code to report subagents, and tells waiting apart from a permission question', () => {
    const { hooks } = JSON.parse(claudeCode.buildStatusSettings());
    expect(hooks.SubagentStart[0].hooks[0].command).toContain('HATSTAND_ACTIVITY_FILE');
    expect(hooks.SubagentStop[0].hooks[0].command).toContain('HATSTAND_ACTIVITY_FILE');
    expect(hooks.PreToolUse.some((entry: { matcher: string }) => entry.matcher === 'Agent|Task')).toBe(true);
    const notice = (matcher: string) => hooks.Notification.find((entry: { matcher: string }) => entry.matcher.includes(matcher)).hooks[0].command;
    expect(notice('idle_prompt')).toContain('printf waiting');
    expect(notice('permission_prompt')).toContain('printf needs-input');
  });

  it('lets Claude Code run the step command without asking, and forgets the signal on a new prompt', () => {
    const { hooks, permissions } = JSON.parse(claudeCode.buildStatusSettings());
    expect(permissions.allow).toEqual(['Bash(hatstand-step-done:*)', 'Bash(hatstand-check-plan:*)']);
    const commands = hooks.UserPromptSubmit.flatMap((entry: { hooks: { command: string }[] }) => entry.hooks.map((hook) => hook.command));
    expect(commands).toContain(`printf '' > "$HATSTAND_STEP_FILE"`);
    expect(commands).toContain('printf working > "$HATSTAND_STATUS_FILE"');
  });
});

describe('the default client folder', () => {
  const home = '/Users/me';
  const of = (...paths: string[]) => ({ id: 'acme', projects: paths.map((path) => ({ id: path, name: path, path })) });

  it('is the folder that holds every repository', () => {
    expect(defaultClientFolder(of('/code/acme/api', '/code/acme/web/portal'), home)).toBe('/code/acme');
    expect(defaultClientFolder(of('/Users/me/projects/acme/api', '/Users/me/projects/acme/web'), home)).toBe('/Users/me/projects/acme');
  });

  it('is the repository itself when there is only one, such as a monorepo', () => {
    expect(defaultClientFolder(of('/code/acme/mono'), home)).toBe('/code/acme/mono');
  });

  it('falls back to a projects folder when there is nothing specific to use', () => {
    expect(defaultClientFolder(of(), home)).toBe('/Users/me/projects/acme');
    expect(defaultClientFolder(of('/Users/me/a', '/Users/me/b'), home)).toBe('/Users/me/projects/acme');
    expect(defaultClientFolder(of('/a/x', '/b/y'), home)).toBe('/Users/me/projects/acme');
  });
});

describe('removing a client', () => {
  const repo = (name: string) => {
    const path = join(dir, name);
    mkdirSync(path);
    execFileSync('git', ['init', '-q'], { cwd: path });
    return { id: name, name, path };
  };
  const setup = () => {
    const paths = dataPaths(join(dir, 'home'));
    const store = new Store(paths);
    const api = repo('api');
    const web = repo('web');
    const company = store.saveCompany({ ...store.createCompany('Acme', '#112233'), projects: [api, web], archivedAt: '2026-01-01' });
    writeFileSync(paths.secretsFile('acme'), 'encrypted');
    writeFileSync(join(paths.knowledgeDir('acme'), 'map.md'), 'client knowledge');
    mkdirSync(paths.guardDir, { recursive: true });
    writeFileSync(paths.guardFingerprints('acme'), '{}');
    const task = store.createTask({ companyId: 'acme', title: 'Keep' });
    store.saveSession({ id: '00000000-0000-4000-8000-000000000001', taskId: task.id, companyId: 'acme', accountId: 'c', cwd: '/', state: 'stopped', startedAt: 'x', updatedAt: 'x' });
    const previous = join(web.path, '.git', 'hooks', 'pre-commit');
    mkdirSync(join(web.path, '.git', 'hooks'), { recursive: true });
    writeFileSync(previous, '#!/bin/sh\nexit 0\n');
    installPreCommitHook(api.path, '/node', '/guard.cjs');
    installPreCommitHook(web.path, '/node', '/guard.cjs', true);
    return { paths, store, company, api, web, previous };
  };

  it('refuses a client that is not archived', () => {
    const { paths, store, company } = setup();
    store.saveCompany({ ...company, archivedAt: undefined });
    expect(() => removeClient(store, paths, 'acme', true)).toThrow(/Archive this client/);
    expect(existsSync(paths.company('acme'))).toBe(true);
  });

  it('can keep the files, without the keys, and restores the repositories', () => {
    const { paths, store, api, previous } = setup();
    const report = removeClient(store, paths, 'acme', false, new Date('2026-03-04T05:06:07Z'));
    const kept = join(paths.removedDir, 'acme-20260304-050607');
    expect(report.keptFilesIn).toBe(kept);
    expect(readFileSync(join(kept, 'knowledge', 'map.md'), 'utf8')).toBe('client knowledge');
    expect(existsSync(join(kept, 'secrets.enc'))).toBe(false);
    expect(existsSync(paths.company('acme'))).toBe(false);
    expect(store.listCompanies()).toEqual([]);
    expect(store.listSessions()).toEqual([]);
    expect(existsSync(paths.guardFingerprints('acme'))).toBe(true);
    expect(existsSync(join(api.path, '.git', 'hooks', 'pre-commit'))).toBe(false);
    expect(readFileSync(previous, 'utf8')).toBe('#!/bin/sh\nexit 0\n');
    expect(report.protectionRemoved).toHaveLength(2);
  });

  it('can delete the files, and never touches the repositories themselves', () => {
    const { paths, store, api } = setup();
    writeFileSync(join(api.path, 'code.txt'), 'my code');
    const report = removeClient(store, paths, 'acme', true);
    expect(report.keptFilesIn).toBeUndefined();
    expect(existsSync(paths.company('acme'))).toBe(false);
    expect(existsSync(paths.guardFingerprints('acme'))).toBe(false);
    expect(readFileSync(join(api.path, 'code.txt'), 'utf8')).toBe('my code');
    expect(existsSync(paths.removedDir)).toBe(false);
  });

  it('does not claim a commit check it never installed', () => {
    const { paths, store, company, api } = setup();
    const bare = repo('bare');
    store.saveCompany({ ...company, projects: [api, bare] });
    const report = removeClient(store, paths, company.id, true);
    expect(report.protectionRemoved).toEqual([api.path]);
    expect(report.protectionKept).toEqual([]);
  });

  it('keeps the commit check in a repository another client uses', () => {
    const { paths, store, api, company } = setup();
    store.saveCompany({ ...store.createCompany('Other', '#223344'), projects: [{ id: 'api', name: 'api', path: api.path }] });
    const report = removeClient(store, paths, company.id, true);
    expect(report.protectionKept).toEqual([api.path]);
    expect(existsSync(join(api.path, '.git', 'hooks', 'pre-commit'))).toBe(true);
    expect(store.listCompanies().map((item) => item.id)).toEqual(['other']);
  });
});
