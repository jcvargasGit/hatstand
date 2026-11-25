import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertOutsideGit, dataPaths, resolveUserPath, type DataPaths } from '../../src/main/paths';
import { SecretStore, type SecretCipher } from '../../src/main/secrets';
import { slugify, Store } from '../../src/main/store';

const reversingCipher: SecretCipher = {
  encrypt: (plain) => Buffer.from([...plain].reverse().join('')),
  decrypt: (sealed) => [...sealed.toString()].reverse().join(''),
};

let home: string;
let paths: DataPaths;
let store: Store;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-store-')));
  paths = dataPaths(home);
  store = new Store(paths);
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('the documents an agent saves for a task', () => {
  const setup = () => {
    const company = store.createCompany('Outputs', '#112233');
    const task = store.createTask({ companyId: company.id, title: 'Write a report' });
    const file = (name: string) => join(paths.tasksDir(company.id), name);
    return { task, file };
  };

  it('lists them by short name, without the notes, the feedback or other tasks', () => {
    const { task, file } = setup();
    store.writeNotes(task, 'notes');
    writeFileSync(paths.feedbackFile(task.companyId, task.id), 'feedback');
    writeFileSync(file(`${task.id}.report.md`), 'report');
    writeFileSync(file('another-task.report.md'), 'other');
    expect(store.listTaskOutputs(task).map((output) => output.name)).toEqual(['report.md']);
  });

  it('only opens files of that list', () => {
    const { task, file } = setup();
    writeFileSync(file(`${task.id}.report.md`), 'report');
    writeFileSync(file('another-task.report.md'), 'other');
    expect(store.taskOutputFile(task, 'report.md')).toBe(file(`${task.id}.report.md`));
    expect(() => store.taskOutputFile(task, '../another-task.report.md')).toThrow('not an output');
  });

  it('ignores a link that points to another file', () => {
    const { task, file } = setup();
    writeFileSync(file('secret.txt'), 'private');
    symlinkSync(file('secret.txt'), file(`${task.id}.link.md`));
    expect(store.listTaskOutputs(task)).toEqual([]);
  });

  it('removes them with the task', () => {
    const { task, file } = setup();
    writeFileSync(file(`${task.id}.report.md`), 'report');
    store.deleteTask(task.id);
    expect(existsSync(file(`${task.id}.report.md`))).toBe(false);
  });
});

describe('what the agent reports in the notes', () => {
  const write = (id: string, status: string) => store.writeNotes(store.findTask(id), `## TL;DR\nx\n\n## Status\n${status}\n`);

  it('records done without closing the task', () => {
    const company = store.createCompany('Status', '#112233');
    const task = store.createTask({ companyId: company.id, title: 'Report' });
    write(task.id, 'in progress');
    store.applyAgentStatus(task.id);
    expect(store.findTask(task.id).agentStatus).toBe('in progress');
    write(task.id, 'done');
    store.applyAgentStatus(task.id);
    expect(store.findTask(task.id)).toMatchObject({ status: 'todo', agentStatus: 'done' });
  });

  it('clears the report of the agent when you reopen a closed task, so it does not look finished again', () => {
    const company = store.createCompany('Reopen', '#112233');
    const task = store.createTask({ companyId: company.id, title: 'Report' });
    write(task.id, 'done');
    store.applyAgentStatus(task.id);
    store.updateTask(task.id, { status: 'done' });
    store.updateTask(task.id, { status: 'doing' });
    expect(store.findTask(task.id)).toMatchObject({ status: 'doing', agentStatus: 'in progress' });
    expect(store.readNotes(store.findTask(task.id))).toContain('## Status\nin progress');
    store.applyAgentStatus(task.id);
    expect(store.findTask(task.id).agentStatus).toBe('in progress');
    write(task.id, 'done');
    store.applyAgentStatus(task.id);
    expect(store.findTask(task.id).agentStatus).toBe('done');
  });
});

describe('the flag of a task', () => {
  const setup = () => {
    const company = store.createCompany('Flags', '#112233');
    return store.createTask({ companyId: company.id, title: 'Ship the fix' });
  };
  const onDisk = (task: { companyId: string; id: string }) => JSON.parse(readFileSync(paths.taskFile(task.companyId, task.id), 'utf8'));

  it('starts without one, and loads a task saved before flags existed', () => {
    const task = setup();
    expect(task.flag).toBeUndefined();
    expect('flag' in onDisk(task)).toBe(false);
    expect(new Store(paths).findTask(task.id).flag).toBeUndefined();
  });

  it('saves it, and keeps it when the task is read again or changed', () => {
    const task = setup();
    expect(store.updateTask(task.id, { flag: ' 🚩 ' }).flag).toBe('🚩');
    expect(onDisk(task).flag).toBe('🚩');
    expect(new Store(paths).findTask(task.id).flag).toBe('🚩');
    expect(store.updateTask(task.id, { priority: 'high' }).flag).toBe('🚩');
    expect(store.updateTask(task.id, { flag: '⭐' }).flag).toBe('⭐');
  });

  it('removes it with an empty value, and writes no empty field', () => {
    const task = setup();
    store.updateTask(task.id, { flag: '🚩' });
    expect(store.updateTask(task.id, { flag: '' }).flag).toBeUndefined();
    expect('flag' in onDisk(task)).toBe(false);
  });

  it('does not move the task or change the rest of it', () => {
    const task = setup();
    const flagged = store.updateTask(task.id, { flag: '🚩' });
    expect({ ...flagged, flag: undefined, updatedAt: task.updatedAt }).toEqual({ ...task, flag: undefined });
  });

  it('refuses a text that is not a short mark', () => {
    const task = setup();
    expect(() => store.updateTask(task.id, { flag: 'this is a whole sentence' })).toThrow();
    expect(store.findTask(task.id).flag).toBeUndefined();
  });
});

describe('sending a task back to the backlog', () => {
  const setup = () => {
    const company = store.createCompany('Backlog', '#112233');
    const waiting = store.createTask({ companyId: company.id, title: 'Already waiting', rank: 4 }, undefined, 'idea');
    const created = store.createTask({ companyId: company.id, title: 'Export the report', description: 'As a PDF', checklist: ['Pick a library'] });
    const task = store.updateTask(created.id, { status: 'doing', priority: 'high', boardLane: 'needs-you' });
    return { waiting, task };
  };

  it('stores it as an idea at the end of the backlog, with its content and without its board lane', () => {
    const { waiting, task } = setup();
    store.updateTask(task.id, { status: 'idea' });
    const stored = store.findTask(task.id);
    expect(stored).toMatchObject({ status: 'idea', title: 'Export the report', description: 'As a PDF', checklist: task.checklist, priority: 'high' });
    expect(stored.rank).toBe((waiting.rank ?? 0) + 1);
    expect(stored.boardLane).toBeUndefined();
  });

  it('comes back as a task, and an item that stays in the backlog keeps its place', () => {
    const { waiting, task } = setup();
    store.updateTask(task.id, { status: 'idea' });
    expect(store.updateTask(task.id, { status: 'todo' }).status).toBe('todo');
    expect(store.updateTask(waiting.id, { priority: 'low' }).rank).toBe(4);
  });
});

describe('slugify', () => {
  it('makes a safe folder name, including from accents and path characters', () => {
    expect(slugify('Compañía Uno')).toBe('compania-uno');
    expect(slugify('../../etc')).toBe('etc');
    expect(slugify('***')).toBe('client');
  });
});

describe('assertOutsideGit', () => {
  it('refuses a data folder inside a repository', () => {
    mkdirSync(join(home, '.git'));
    const inside = join(home, 'nested/data');
    expect(() => assertOutsideGit(inside)).toThrow(/inside the git repository/);
  });

  it('accepts a folder outside any repository', () => {
    expect(() => assertOutsideGit(home)).not.toThrow();
  });
});

describe('resolveUserPath', () => {
  beforeEach(() => {
    mkdirSync(join(home, '.claude/my docs'), { recursive: true });
    writeFileSync(join(home, '.claude/notes.md'), '');
  });

  it('accepts hidden folders, ~ and the forms a path takes when pasted', () => {
    const expected = join(home, '.claude/my docs');
    expect(resolveUserPath(expected, 'directory')).toBe(expected);
    expect(resolveUserPath('~/.claude/my docs', 'directory', home)).toBe(expected);
    expect(resolveUserPath(`  "${expected}"  `, 'directory')).toBe(expected);
    expect(resolveUserPath(expected.replace('my docs', 'my\\ docs'), 'directory')).toBe(expected);
    expect(resolveUserPath(`${expected}/`, 'directory')).toBe(expected);
  });

  it('explains each kind of wrong path', () => {
    expect(() => resolveUserPath('.claude/my docs', 'directory', home)).toThrow(/full path/);
    expect(() => resolveUserPath(join(home, 'missing'), 'directory')).toThrow(/does not exist/);
    expect(() => resolveUserPath(join(home, '.claude/notes.md'), 'directory')).toThrow(/is a file/);
    expect(() => resolveUserPath(join(home, '.claude'), 'file')).toThrow(/is a folder/);
  });
});

describe('Store', () => {
  it('gives clients with the same name separate folders', () => {
    const first = store.createCompany('Acme', '#112233');
    const second = store.createCompany('Acme', '#445566');
    expect([first.id, second.id]).toEqual(['acme', 'acme-2']);
    expect(store.listCompanies()).toHaveLength(2);
  });

  it('reads one session by its id, and nothing for an id that is not a saved session', () => {
    const now = new Date().toISOString();
    const [one, two, three] = [randomUUID(), randomUUID(), randomUUID()];
    const session = { id: one, taskId: 't', companyId: 'acme', accountId: 'a', cwd: home, state: 'idle' as const, startedAt: now, updatedAt: now };
    store.saveSession(session);
    store.saveSession({ ...session, id: two, state: 'working' });
    expect(store.readSession(two)).toMatchObject({ id: two, state: 'working' });
    expect(store.readSession(three)).toBeUndefined();
    mkdirSync(join(paths.sessionsDir, 'nested'));
    writeFileSync(join(paths.sessionsDir, 'nested', `${one}.json`), readFileSync(paths.sessionFile(one)));
    expect(store.readSession(`nested/${one}`)).toBeUndefined();
  });

  it('keeps client files readable only by the owner', () => {
    const company = store.createCompany('Acme', '#112233');
    expect(statSync(paths.companyFile(company.id)).mode & 0o777).toBe(0o600);
    expect(statSync(home).mode & 0o777).toBe(0o700);
  });

  it('stores tasks and notes per client', () => {
    const acme = store.createCompany('Acme', '#112233');
    const other = store.createCompany('Other', '#445566');
    const task = store.createTask({ companyId: acme.id, title: 'Fix login' });
    store.writeNotes(task, 'Next: add the test');

    expect(store.listTasks(other.id)).toEqual([]);
    expect(store.findTask(task.id).status).toBe('todo');
    expect(store.readNotes(task)).toBe('Next: add the test');
    expect(store.updateTask(task.id, { status: 'done' }).status).toBe('done');
  });

  it('numbers tasks per client, and never reuses a number', () => {
    const acme = store.createCompany('Acme', '#112233');
    const other = store.createCompany('Other', '#445566');
    const first = store.createTask({ companyId: acme.id, title: 'First' });
    const second = store.createTask({ companyId: acme.id, title: 'Second' });
    expect([first.number, second.number]).toEqual([1, 2]);
    expect(store.createTask({ companyId: other.id, title: 'Elsewhere' }).number).toBe(1);

    store.deleteTask(second.id);
    expect(store.createTask({ companyId: acme.id, title: 'Third' }).number).toBe(3);
    expect(store.updateTask(first.id, { title: 'Renamed' }).number).toBe(1);
  });

  it('finds a task by its client and number, or by its id, from any client', () => {
    const acme = store.createCompany('Acme', '#112233');
    const globex = store.createCompany('Globex', '#445566');
    const inAcme = store.createTask({ companyId: acme.id, title: 'Fix login' });
    const inGlobex = store.createTask({ companyId: globex.id, title: 'Gallery' }, undefined, 'idea');
    expect([inAcme.number, inGlobex.number]).toEqual([1, 1]);

    expect(store.findTaskByReference('acme#1').id).toBe(inAcme.id);
    expect(store.findTaskByReference('globex#1').id).toBe(inGlobex.id);
    expect(store.findTaskByReference(inGlobex.id.toUpperCase()).id).toBe(inGlobex.id);
    expect(() => store.findTaskByReference('initech#1')).toThrow('There is no client with the id initech.');
    expect(() => store.findTaskByReference('acme#2')).toThrow('The client acme has no task #2.');
    expect(() => store.findTaskByReference('11111111-2222-3333-4444-555555555555')).toThrow(/no longer exists/);
    expect(() => store.findTaskByReference('#1')).toThrow(/acme#12, or the UUID/);
  });

  it('numbers existing tasks by creation date, once, without touching their dates', () => {
    const acme = store.createCompany('Acme', '#112233');
    const write = (id: string, createdAt: string) =>
      writeFileSync(paths.taskFile(acme.id, id), JSON.stringify({ id, companyId: acme.id, title: id, status: 'todo', createdAt, updatedAt: createdAt }));
    mkdirSync(paths.tasksDir(acme.id), { recursive: true });
    write('later', '2026-02-01T00:00:00.000Z');
    write('earlier', '2026-01-01T00:00:00.000Z');

    const numbers = () => Object.fromEntries(store.listTasks(acme.id).map((task) => [task.id, task.number]));
    expect(numbers()).toEqual({ earlier: 1, later: 2 });
    expect(numbers()).toEqual({ earlier: 1, later: 2 });
    expect(store.findTask('later').updatedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(store.createTask({ companyId: acme.id, title: 'New' }).number).toBe(3);
  });

  it('starts with one account and keeps at least one', () => {
    const { accounts, defaultAccountId } = store.readAccounts();
    expect(accounts).toHaveLength(1);
    expect(() => store.removeAccount(defaultAccountId ?? '')).toThrow(/at least one/);
  });
});

describe('moving a task that was not started to another client', () => {
  const setup = () => {
    const acme = store.createCompany('Acme', '#112233');
    const globex = store.createCompany('Globex', '#445566');
    store.saveCompany({ ...store.readCompany(acme.id), projects: [{ id: 'api', name: 'api', path: '/code/api' }] });
    store.createTask({ companyId: globex.id, title: 'Already there' });
    const task = store.createTask({ companyId: acme.id, title: 'In the wrong client', description: 'Details', projectIds: ['api'], checklist: ['One'], priority: 'high' });
    return { acme, globex, task };
  };
  const move = (taskId: string, companyId: string) => store.moveTask(taskId, companyId, {});

  it('gives it the next number there, the default area and no repositories, and keeps its content', () => {
    const { acme, globex, task } = setup();
    const moved = move(task.id, globex.id);

    expect(moved).toMatchObject({ id: task.id, companyId: globex.id, number: 2, title: 'In the wrong client', description: 'Details', priority: 'high', projectIds: [] });
    expect(moved.subdomainId).toBe(store.readCompany(globex.id).defaultAreaId);
    expect(moved.checklist.map((item) => item.text)).toEqual(['One']);
    expect(store.listTasks(globex.id).map((item) => item.number)).toEqual(expect.arrayContaining([1, 2]));
    expect(store.listTasks(acme.id)).toEqual([]);
    expect(store.findTask(task.id).companyId).toBe(globex.id);
  });

  it('takes its notes and documents along', () => {
    const { acme, globex, task } = setup();
    store.writeNotes(task, 'my notes');
    writeFileSync(join(paths.tasksDir(acme.id), `${task.id}.report.md`), 'report');
    const moved = move(task.id, globex.id);

    expect(store.readNotes(moved)).toBe('my notes');
    expect(store.listTaskOutputs(moved).map((output) => output.name)).toEqual(['report.md']);
    expect(existsSync(paths.notesFile(acme.id, task.id))).toBe(false);
    expect(existsSync(join(paths.tasksDir(acme.id), `${task.id}.report.md`))).toBe(false);
  });

  it('changes its reference, and never gives its old number to another task', () => {
    const { acme, globex, task } = setup();
    move(task.id, globex.id);

    expect(store.findTaskByReference('globex#2').id).toBe(task.id);
    expect(() => store.findTaskByReference('acme#1')).toThrow('has no task #1');
    expect(store.createTask({ companyId: acme.id, title: 'Next' }).number).toBe(2);
  });

  it('keeps the agent and the guide it is given, and drops them otherwise', () => {
    const { globex, task } = setup();
    const guide = { playbookId: 'implement', name: 'Implement a task', steps: [{ name: 'Understand', prompt: 'Read it.' }], current: 0, promptPending: true, done: [] };
    const guided = store.updateTask(task.id, { accountId: 'claude-default', guide });

    expect(store.moveTask(guided.id, globex.id, { accountId: 'claude-default', guide })).toMatchObject({ accountId: 'claude-default', guide });
    const other = store.updateTask(store.createTask({ companyId: 'acme', title: 'Another' }).id, { accountId: 'claude-default', guide });
    const moved = move(other.id, globex.id);
    expect(moved.accountId).toBeUndefined();
    expect(moved.guide).toBeUndefined();
  });

  it('puts a backlog item at the end of the backlog there', () => {
    const { acme, globex } = setup();
    store.createTask({ companyId: globex.id, title: 'Last there', rank: 3 }, undefined, 'idea');
    const idea = store.createTask({ companyId: acme.id, title: 'An idea', rank: 0 }, undefined, 'idea');
    expect(move(idea.id, globex.id)).toMatchObject({ status: 'idea', rank: 4 });
  });

  it('keeps its issue, unless a task there is linked to the same one', () => {
    const { acme, globex, task } = setup();
    const source = { kind: 'github' as const, key: 'acme/api#7' };
    store.linkTaskSource(task.id, source);
    const twin = store.linkTaskSource(store.createTask({ companyId: acme.id, title: 'Twin' }).id, { kind: 'github', key: 'acme/api#8' });
    store.linkTaskSource(store.findTaskByReference('globex#1').id, { kind: 'github', key: 'acme/api#8' });

    expect(move(task.id, globex.id).source).toEqual(source);
    expect(() => move(twin.id, globex.id)).toThrow('acme/api#8 is already linked to task #1 of Globex.');
    expect(store.findTask(twin.id).companyId).toBe(acme.id);
  });

  it('refuses the same client, a client that is gone, and an archived one', () => {
    const { acme, globex, task } = setup();
    expect(() => move(task.id, acme.id)).toThrow('already in this client');
    expect(() => move(task.id, 'nowhere')).toThrow('no longer exists');
    store.saveCompany({ ...store.readCompany(globex.id), archivedAt: 'now' });
    expect(() => move(task.id, globex.id)).toThrow('Globex is archived');
    expect(store.findTask(task.id).companyId).toBe(acme.id);
  });

  it('leaves a task that plans the backlog, and the items of its plan, where they are', () => {
    const { acme, globex } = setup();
    const idea = store.createTask({ companyId: acme.id, title: 'Planned idea' }, undefined, 'idea');
    const planner = store.setBacklogPlan(store.createTask({ companyId: acme.id, title: 'Plan the backlog' }).id, { items: [{ id: idea.id, number: idea.number ?? 0 }] });

    expect(() => move(planner.id, globex.id)).toThrow('plans the backlog');
    expect(() => move(idea.id, globex.id)).toThrow(`part of the backlog plan #${planner.number}`);
    store.updateTask(planner.id, { status: 'done' });
    expect(move(idea.id, globex.id).companyId).toBe(globex.id);
  });
});

describe('SecretStore', () => {
  it('never writes plain values and keeps clients apart', () => {
    const secrets = new SecretStore(paths, reversingCipher);
    store.createCompany('Acme', '#112233');
    secrets.merge('acme', { JIRA_API_TOKEN: 'plain-value' });

    expect(readFileSync(paths.secretsFile('acme'), 'utf8')).not.toContain('plain-value');
    expect(secrets.read('acme')).toEqual({ JIRA_API_TOKEN: 'plain-value' });
    expect(secrets.read('other')).toEqual({});
    expect(secrets.names('acme')).toEqual(['JIRA_API_TOKEN']);

    secrets.remove('acme', 'JIRA_API_TOKEN');
    expect(secrets.names('acme')).toEqual([]);
  });
});

describe('what the SecretStore knows about each key', () => {
  let clock: Date;
  let secrets: SecretStore;
  const details = () => readFileSync(paths.keyDetailsFile('acme'), 'utf8');

  beforeEach(() => {
    clock = new Date('2026-11-18T10:00:00.000Z');
    secrets = new SecretStore(paths, reversingCipher, () => clock);
    store.createCompany('Acme', '#112233');
  });

  it('keeps when a key was saved next to secrets.enc, and never its value', () => {
    secrets.merge('acme', { GITHUB_TOKEN: 'plain-value', ACME_API_TOKEN: 'other-value' });
    expect(secrets.list('acme')).toEqual([
      { name: 'ACME_API_TOKEN', savedAt: '2026-11-18T10:00:00.000Z' },
      { name: 'GITHUB_TOKEN', savedAt: '2026-11-18T10:00:00.000Z' },
    ]);
    expect(details()).not.toContain('plain-value');
    expect(details()).not.toContain('other-value');
    expect(statSync(paths.keyDetailsFile('acme')).mode & 0o777).toBe(0o600);
  });

  it('lists keys saved before keys.yaml existed', () => {
    secrets.merge('acme', { GITHUB_TOKEN: 'plain-value' });
    rmSync(paths.keyDetailsFile('acme'));
    expect(secrets.list('acme')).toEqual([{ name: 'GITHUB_TOKEN' }]);
    expect(secrets.read('acme')).toEqual({ GITHUB_TOKEN: 'plain-value' });
  });

  it('carries on when keys.yaml is damaged', () => {
    secrets.merge('acme', { GITHUB_TOKEN: 'plain-value' });
    writeFileSync(paths.keyDetailsFile('acme'), 'keys: [not, a, map');
    expect(secrets.list('acme')).toEqual([{ name: 'GITHUB_TOKEN' }]);
    expect(secrets.recordCheck('acme', 'GITHUB_TOKEN', { result: 'valid' })).toBe(true);
    expect(secrets.list('acme')[0]?.check?.result).toBe('valid');
  });

  it('remembers a check, and writes nothing when the answer is the same', () => {
    secrets.merge('acme', { GITHUB_TOKEN: 'plain-value' });
    const expiresAt = '2026-12-01T08:00:00.000Z';
    expect(secrets.recordCheck('acme', 'GITHUB_TOKEN', { result: 'valid', expiresAt })).toBe(true);
    expect(secrets.list('acme')[0]?.check).toEqual({ at: '2026-11-18T10:00:00.000Z', result: 'valid', expiresAt });

    const written = details();
    clock = new Date('2026-11-19T10:00:00.000Z');
    expect(secrets.recordCheck('acme', 'GITHUB_TOKEN', { result: 'valid', expiresAt })).toBe(false);
    expect(details()).toBe(written);

    expect(secrets.recordCheck('acme', 'GITHUB_TOKEN', { result: 'rejected' })).toBe(true);
    expect(secrets.list('acme')[0]?.check).toEqual({ at: '2026-11-19T10:00:00.000Z', result: 'rejected' });
  });

  it('records nothing about a key the client does not have', () => {
    expect(secrets.recordCheck('acme', 'GITHUB_TOKEN', { result: 'rejected' })).toBe(false);
    expect(existsSync(paths.keyDetailsFile('acme'))).toBe(false);
  });

  it('starts a replaced key over, and leaves a key saved again with the same value alone', () => {
    secrets.merge('acme', { GITHUB_TOKEN: 'old-value', GITLAB_TOKEN: 'same-value' });
    secrets.recordCheck('acme', 'GITHUB_TOKEN', { result: 'rejected' });
    secrets.recordCheck('acme', 'GITLAB_TOKEN', { result: 'valid' });
    clock = new Date('2026-11-20T10:00:00.000Z');
    secrets.merge('acme', { GITHUB_TOKEN: 'new-value', GITLAB_TOKEN: 'same-value' });

    const [github, gitlab] = secrets.list('acme');
    expect(github).toEqual({ name: 'GITHUB_TOKEN', savedAt: '2026-11-20T10:00:00.000Z' });
    expect(gitlab?.savedAt).toBe('2026-11-18T10:00:00.000Z');
    expect(gitlab?.check?.result).toBe('valid');
  });

  it('forgets a rejection once the provider accepts the key, and only a rejection', () => {
    secrets.merge('acme', { GITHUB_TOKEN: 'plain-value' });
    secrets.recordCheck('acme', 'GITHUB_TOKEN', { result: 'valid' });
    expect(secrets.clearRejection('acme', 'GITHUB_TOKEN')).toBe(false);
    secrets.recordCheck('acme', 'GITHUB_TOKEN', { result: 'rejected' });
    expect(secrets.clearRejection('acme', 'GITHUB_TOKEN')).toBe(true);
    expect(secrets.list('acme')).toEqual([{ name: 'GITHUB_TOKEN', savedAt: '2026-11-18T10:00:00.000Z' }]);
  });

  it('keeps a note through a replace, and drops everything when the key is deleted', () => {
    secrets.merge('acme', { ACME_API_TOKEN: 'plain-value' });
    secrets.setNote('acme', 'ACME_API_TOKEN', '  Billing sandbox  ');
    secrets.merge('acme', { ACME_API_TOKEN: 'new-value' });
    expect(secrets.list('acme')[0]?.note).toBe('Billing sandbox');

    secrets.setNote('acme', 'ACME_API_TOKEN', ' ');
    expect(secrets.list('acme')[0]).not.toHaveProperty('note');
    expect(() => secrets.setNote('acme', 'MISSING', 'x')).toThrow(/no key called MISSING/);

    secrets.remove('acme', 'ACME_API_TOKEN');
    expect(secrets.list('acme')).toEqual([]);
    expect(details()).not.toContain('ACME_API_TOKEN');
  });
});
