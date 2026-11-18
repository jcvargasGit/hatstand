import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { canAskForCopies, TaskCopies } from '../../src/main/session-copies';
import type { Session, Task } from '../../src/shared/schemas';
import { makeCommittedRepo, makeHome, type TestHome } from '../helpers/home';
import { noSecrets } from '../helpers/sessions';

let home: TestHome;
let api: string;
let task: Task;
let onChange: Mock<() => void>;
let copies: TaskCopies;

beforeEach(() => {
  home = makeHome('hatstand-session-copies-');
  api = makeCommittedRepo(home.folder('code', 'api'));
  home.store.saveCompany({
    ...home.store.createCompany('Acme', '#112233'),
    projects: [
      { id: 'api', name: 'api', path: api },
      { id: 'notes', name: 'notes', path: home.folder('code', 'notes') },
    ],
  });
  task = home.store.createTask({ companyId: 'acme', title: 'Fix login' });
  onChange = vi.fn<() => void>();
  copies = new TaskCopies(home.paths, home.store, noSecrets, process.env.PATH ?? '', { onChange });
});
afterEach(() => home.remove());

describe('a copy of a repository for a task', () => {
  it('is made on its own branch, and the task now changes that repository', async () => {
    const worktree = await copies.create(task.id, home.store.readCompany('acme').projects[0]!);
    expect(worktree.path.startsWith(home.paths.taskWorktreesDir('acme', task.id))).toBe(true);
    expect(worktree.branch).toMatch(/^hatstand\/fix-login-/);
    expect(readFileSync(join(worktree.path, 'README.md'), 'utf8')).toBe('hello\n');
    expect(home.store.findTask(task.id)).toMatchObject({ worktrees: [worktree], projectIds: ['api'] });
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('cannot be made of a folder that is not a repository', async () => {
    await expect(copies.create(task.id, home.store.readCompany('acme').projects[1]!)).rejects.toThrow('notes cannot have its own copy.');
    expect(home.store.findTask(task.id).worktrees).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is made again when a session starts and its folder is gone', async () => {
    const worktree = await copies.create(task.id, home.store.readCompany('acme').projects[0]!);
    rmSync(worktree.path, { recursive: true, force: true });
    const restored = await copies.restore(home.store.findTask(task.id), home.store.readCompany('acme'));
    expect(restored.worktrees).toEqual([worktree]);
    expect(existsSync(join(worktree.path, 'README.md'))).toBe(true);
  });

  it('is not made for a task that works in the shared folder', async () => {
    const shared = home.store.updateTask(task.id, { isolated: false });
    expect(await copies.restore(shared, home.store.readCompany('acme'))).toBe(shared);
    expect(existsSync(home.paths.taskWorktreesDir('acme', task.id))).toBe(false);
  });

  it('leaves the originals to be read only, by their real folder', () => {
    home.store.saveCompany({ ...home.store.readCompany('acme'), projects: [{ id: 'api', name: 'api', path: api }, { id: 'gone', name: 'gone', path: join(home.root, 'gone') }] });
    expect(copies.originalRepoFolders('acme')).toEqual([api]);
  });
});

describe('the agent asking for a copy', () => {
  let session: Session;
  let folder: string;
  beforeEach(() => {
    const now = new Date().toISOString();
    session = { id: randomUUID(), taskId: task.id, companyId: 'acme', accountId: 'a', cwd: home.root, state: 'working', startedAt: now, updatedAt: now };
    folder = home.paths.copyRequestsDir(session.id);
    mkdirSync(folder, { recursive: true });
  });
  const ask = (name: string, repo: string) => writeFileSync(join(folder, `${name}.request`), `${repo}\n`);
  const reply = (name: string) =>
    vi.waitFor(
      () => {
        const found = readdirSync(folder).find((file) => file === `${name}.ok` || file === `${name}.error`);
        if (!found) throw new Error('No reply yet.');
        return { kind: found.slice(name.length + 1), text: readFileSync(join(folder, found), 'utf8') };
      },
      { timeout: 10_000 },
    );

  it('answers with the folder and branch of the new copy', async () => {
    ask('1', 'api');
    copies.pollRequests(session, folder);
    expect(existsSync(join(folder, '1.request'))).toBe(false);
    const answer = await reply('1');
    const [worktree] = home.store.findTask(task.id).worktrees;
    expect(answer).toEqual({ kind: 'ok', text: `Your copy of api is ready.\nFolder: ${worktree?.path}\nBranch: ${worktree?.branch}\nWork and commit only in that folder.\n` });
  });

  it('says why when there is no such repository', async () => {
    ask('1', 'web');
    copies.pollRequests(session, folder);
    const answer = await reply('1');
    expect(answer.kind).toBe('error');
    expect(answer.text).toContain('This client has no repository called "web".');
  });

  it('answers one request at a time', async () => {
    ask('1', 'api');
    ask('2', 'notes');
    copies.pollRequests(session, folder);
    copies.pollRequests(session, folder);
    expect(readdirSync(folder).filter((file) => file.endsWith('.request'))).toHaveLength(1);
    const [first] = readdirSync(folder).filter((file) => file.endsWith('.request'));
    await reply(first === '1.request' ? '2' : '1');
    await vi.waitFor(() => {
      copies.pollRequests(session, folder);
      expect(readdirSync(folder).filter((file) => file.endsWith('.request'))).toEqual([]);
    });
  });

  it('waits while the folder is missing or empty', () => {
    rmSync(folder, { recursive: true });
    expect(() => copies.pollRequests(session, folder)).not.toThrow();
    mkdirSync(folder);
    copies.pollRequests(session, folder);
    expect(readdirSync(folder)).toEqual([]);
  });
});

describe('preparing a session to ask for copies', () => {
  const mode = (path: string) => statSync(path).mode & 0o777;
  const prepare = (change: Partial<Task> = {}, plansBacklog = false) => {
    const sessionId = randomUUID();
    const prepared = { ...home.store.findTask(task.id), ...change };
    return { sessionId, setup: copies.prepareSession(sessionId, home.store.readCompany('acme'), prepared, plansBacklog) };
  };

  it('gives a task with copies of its own the folders, the command, and the originals as read only', () => {
    const { sessionId, setup } = prepare();
    expect(setup).toEqual({
      copiesFolder: home.paths.taskWorktreesDir('acme', task.id),
      requestsFolder: home.paths.copyRequestsDir(sessionId),
      env: { HATSTAND_COPY_REQUESTS: home.paths.copyRequestsDir(sessionId), HATSTAND_READ_ONLY_REPOS: JSON.stringify([api, join(home.root, 'code', 'notes')]) },
    });
    expect(mode(home.paths.taskWorktreesDir('acme', task.id))).toBe(0o700);
    expect(mode(home.paths.copyRequestsDir(sessionId))).toBe(0o700);
    expect(mode(home.paths.editRepoTool)).toBe(0o700);
  });

  it('gives nothing to a task that works in the shared folder', () => {
    const { sessionId, setup } = prepare({ isolated: false });
    expect(setup).toEqual({ copiesFolder: null, requestsFolder: null, env: {} });
    expect(existsSync(home.paths.copyRequestsDir(sessionId))).toBe(false);
    expect(existsSync(home.paths.editRepoTool)).toBe(false);
  });

  it('lets a backlog plan read the originals, without asking for copies', () => {
    const { setup } = prepare({}, true);
    expect(setup).toEqual({ copiesFolder: null, requestsFolder: null, env: { HATSTAND_READ_ONLY_REPOS: JSON.stringify([api, join(home.root, 'code', 'notes')]) } });
  });

  it('decides who may ask', () => {
    const company = home.store.readCompany('acme');
    expect(canAskForCopies(company, { isolated: true }, false)).toBe(true);
    expect(canAskForCopies(company, { isolated: false }, false)).toBe(false);
    expect(canAskForCopies(company, { isolated: true }, true)).toBe(false);
    expect(canAskForCopies({ ...company, projects: [] }, { isolated: true }, false)).toBe(false);
  });
});
