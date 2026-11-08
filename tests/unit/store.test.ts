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
