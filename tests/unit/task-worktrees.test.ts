import { buildFingerprints } from '../../src/main/guard/service';
import { sha256 } from '../../src/main/guard/fingerprints';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../../src/main/agents/task-prompt';
import { buildGuardScript } from '../../src/main/guard/hook-script';
import { installPreCommitHook } from '../../src/main/guard/install';
import { fingerprintSecrets } from '../../src/main/guard/fingerprints';
import { dataPaths } from '../../src/main/paths';
import { Store, writePrivateFile } from '../../src/main/store';
import { activeWorktrees, companyWithCode, sessionFolder, taskRepositories } from '../../src/main/task-folders';
import { prepareWorktrees, removeWorktrees, taskBranchName } from '../../src/main/worktrees';
import { companySchema, type Company, type Task } from '../../src/shared/schemas';

const PATH = process.env.PATH ?? '';
let dir: string;
let paths: ReturnType<typeof dataPaths>;
let store: Store;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function makeRepo(name: string): string {
  const path = join(dir, name);
  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q', '-b', 'main');
  writeFileSync(join(path, 'README.md'), 'hello\n');
  git(path, 'add', '.');
  git(path, 'commit', '-qm', 'first');
  return path;
}

function client(repos: { id: string; path: string }[]): Company {
  return companySchema.parse({ id: 'northwind', name: 'Northwind', color: '#5BB8A6', projects: repos.map((repo) => ({ ...repo, name: repo.id })) });
}

function newTask(company: Company, title: string, projectIds: string[]): Task {
  store.saveCompany(company);
  return store.createTask({ companyId: company.id, title, projectIds });
}

const prepare = async (company: Company, task: Task) => {
  const worktrees = await prepareWorktrees({ paths, company, task, repos: taskRepositories(company, task), path: PATH });
  return store.setTaskCode(task.id, worktrees);
};

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-worktrees-')));
  paths = dataPaths(join(dir, 'home'));
  store = new Store(paths);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('a copy of the code per task', () => {
  it('gives new tasks their own copy, and leaves tasks from before in the shared folder', () => {
    const company = client([]);
    expect(newTask(company, 'New', []).isolated).toBe(true);
    const old = { id: 'old', companyId: 'northwind', title: 'Old', status: 'doing', createdAt: 'x', updatedAt: 'x' };
    writePrivateFile(paths.taskFile('northwind', 'old'), JSON.stringify(old));
    expect(store.findTask('old').isolated).toBe(false);
    expect(store.findTask('old').worktrees).toEqual([]);
  });

  it('keeps the work of two tasks in the same repository apart', async () => {
    const repo = makeRepo('api');
    const company = client([{ id: 'api', path: repo }]);
    const first = await prepare(company, newTask(company, 'First task', ['api']));
    const second = await prepare(company, newTask(company, 'Second task', ['api']));

    const [firstCopy] = first.worktrees;
    const [secondCopy] = second.worktrees;
    expect(firstCopy?.branch).not.toBe(secondCopy?.branch);
    writeFileSync(join(firstCopy?.path ?? '', 'only-first.txt'), 'first\n');

    expect(existsSync(join(secondCopy?.path ?? '', 'only-first.txt'))).toBe(false);
    expect(existsSync(join(repo, 'only-first.txt'))).toBe(false);
    expect(git(repo, 'branch', '--show-current')).toBe('main');
    expect(git(firstCopy?.path ?? '', 'branch', '--show-current')).toBe(firstCopy?.branch);
  });

  it('does not set an upstream, so a plain push cannot reach the main branch', async () => {
    const remote = join(dir, 'remote.git');
    const seed = makeRepo('seed');
    git(dir, 'clone', '-q', '--bare', seed, remote);
    git(dir, 'clone', '-q', remote, 'api');
    const repo = join(dir, 'api');
    const company = client([{ id: 'api', path: repo }]);
    const task = await prepare(company, newTask(company, 'Fix', ['api']));
    const [copy] = task.worktrees;

    expect(copy?.base).toBe('origin/main');
    expect(spawnSync('git', ['rev-parse', '--abbrev-ref', '@{upstream}'], { cwd: copy?.path }).status).not.toBe(0);
  });

  it('starts from the latest main branch of the remote, even if the checkout is behind', async () => {
    const remote = join(dir, 'remote.git');
    const seed = makeRepo('seed');
    git(dir, 'clone', '-q', '--bare', seed, remote);
    git(dir, 'clone', '-q', remote, 'api');
    git(seed, 'remote', 'add', 'origin', remote);
    writeFileSync(join(seed, 'newer.txt'), 'newer\n');
    git(seed, 'add', '.');
    git(seed, 'commit', '-qm', 'newer');
    git(seed, 'push', '-q', 'origin', 'main');
    const company = client([{ id: 'api', path: join(dir, 'api') }]);
    const task = await prepare(company, newTask(company, 'Fix', ['api']));

    expect(existsSync(join(task.worktrees[0]?.path ?? '', 'newer.txt'))).toBe(true);
    expect(existsSync(join(dir, 'api', 'newer.txt'))).toBe(false);
  });

  it('reuses the copy, and brings it back from the branch if the folder is gone', async () => {
    const repo = makeRepo('api');
    const company = client([{ id: 'api', path: repo }]);
    const task = await prepare(company, newTask(company, 'Fix', ['api']));
    const [copy] = task.worktrees;
    writeFileSync(join(copy?.path ?? '', 'work.txt'), 'work\n');
    git(copy?.path ?? '', 'add', '.');
    git(copy?.path ?? '', 'commit', '-qm', 'work');

    expect((await prepare(company, task)).worktrees).toEqual(task.worktrees);

    const report = await removeWorktrees(company, task, PATH);
    expect(report.kept).toEqual([]);
    expect(existsSync(copy?.path ?? '')).toBe(false);
    const restored = await prepare(company, store.setTaskCode(task.id, []));
    expect(readFileSync(join(restored.worktrees[0]?.path ?? '', 'work.txt'), 'utf8')).toBe('work\n');
  });

  it('never removes a copy with work that is not committed', async () => {
    const repo = makeRepo('api');
    const company = client([{ id: 'api', path: repo }]);
    const task = await prepare(company, newTask(company, 'Fix', ['api']));
    const [copy] = task.worktrees;
    writeFileSync(join(copy?.path ?? '', 'unsaved.txt'), 'unsaved\n');

    const report = await removeWorktrees(company, task, PATH);

    expect(report.removed).toEqual([]);
    expect(report.kept[0]?.reason).toContain('not committed');
    expect(readFileSync(join(copy?.path ?? '', 'unsaved.txt'), 'utf8')).toBe('unsaved\n');
  });

  it('skips folders it cannot copy and keeps going', async () => {
    const empty = join(dir, 'empty');
    mkdirSync(empty);
    git(empty, 'init', '-q');
    const plain = join(dir, 'plain');
    mkdirSync(plain);
    const repo = makeRepo('api');
    const company = client([{ id: 'empty', path: empty }, { id: 'plain', path: plain }, { id: 'api', path: repo }]);
    const task = await prepare(company, newTask(company, 'Fix', ['empty', 'plain', 'api']));
    expect(task.worktrees.map((item) => item.projectId)).toEqual(['api']);
  });

  it('opens the session in the copy, or in a folder holding all of them', async () => {
    const api = makeRepo('api');
    const web = makeRepo('web');
    const company = client([{ id: 'api', path: api }, { id: 'web', path: web }]);
    const single = await prepare(company, newTask(company, 'One', ['api']));
    const both = await prepare(company, newTask(company, 'Two', ['api', 'web']));

    expect(sessionFolder(activeWorktrees(company, single))).toBe(single.worktrees[0]?.path);
    expect(sessionFolder(activeWorktrees(company, both))).toBe(paths.taskWorktreesDir(company.id, both.id));
    expect(companyWithCode(company, single).projects.find((repo) => repo.id === 'api')?.path).toBe(single.worktrees[0]?.path);
    expect(companyWithCode(company, single).projects.find((repo) => repo.id === 'web')?.path).toBe(web);
    expect(activeWorktrees(company, store.updateTask(single.id, { isolated: false }))).toEqual([]);
  });

  it('tells the agent where to work', async () => {
    const repo = makeRepo('api');
    const company = client([{ id: 'api', path: repo }]);
    const task = await prepare(company, newTask(company, 'Fix', ['api']));
    const code = companyWithCode(company, task);
    const prompt = buildSystemPrompt({ company: code, task, repositories: code.projects, companyInstructions: '', knowledgeDirs: [], notesFile: '/notes', notes: '' });
    expect(prompt).toContain(`- ${task.worktrees[0]?.path} on branch ${task.worktrees[0]?.branch}`);
    expect(prompt).toContain('stay on that branch');
    expect(prompt).not.toContain(`(${repo})`);
  });

  it('keeps commit protection working inside the copy', async () => {
    const repo = makeRepo('api');
    const guardScript = join(paths.guardDir, 'guard.cjs');
    writePrivateFile(guardScript, buildGuardScript());
    const secret = 'super-secret-value-123456';
    writePrivateFile(join(paths.guardDir, 'northwind.json'), JSON.stringify({ company: 'Northwind', lineHashes: [], secrets: fingerprintSecrets({ API_KEY: secret }) }));
    expect(installPreCommitHook(repo, process.execPath, guardScript).installed).toBe(true);

    const company = client([{ id: 'api', path: repo }]);
    const task = await prepare(company, newTask(company, 'Fix', ['api']));
    const copy = task.worktrees[0]?.path ?? '';
    writeFileSync(join(copy, 'leak.ts'), `export const key = "${secret}";\n`);
    git(copy, 'add', '.');
    const commit = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'leak'], { cwd: copy, encoding: 'utf8' });

    expect(commit.status).not.toBe(0);
    expect(commit.stderr).toContain('hatstand guard blocked this commit');
  });

  it('blocks commits in a repository the task only reads, and allows them in its copy and elsewhere', async () => {
    const repo = makeRepo('api');
    const planning = makeRepo('planning');
    const guardScript = join(paths.guardDir, 'guard.cjs');
    writePrivateFile(guardScript, buildGuardScript());
    writePrivateFile(join(paths.guardDir, 'northwind.json'), JSON.stringify({ company: 'Northwind', lineHashes: [], secrets: [] }));
    expect(installPreCommitHook(repo, process.execPath, guardScript).installed).toBe(true);
    expect(installPreCommitHook(planning, process.execPath, guardScript).installed).toBe(true);

    const company = client([{ id: 'api', path: repo }]);
    const task = await prepare(company, newTask(company, 'Fix', ['api']));
    const copy = task.worktrees[0]?.path ?? '';
    const commitIn = (folder: string) => {
      writeFileSync(join(folder, 'change.txt'), 'change\n');
      git(folder, 'add', '.');
      return spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'change'], {
        cwd: folder,
        encoding: 'utf8',
        env: { ...process.env, HATSTAND_READ_ONLY_REPOS: JSON.stringify([repo]) },
      });
    };

    const blocked = commitIn(repo);
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain('hatstand-edit-repo');
    expect(commitIn(copy).status).toBe(0);
    expect(commitIn(planning).status).toBe(0);
  });

  it('protects the private files of an area', () => {
    const company = client([]);
    const folder = paths.areaDir(company.id, 'reports');
    mkdirSync(folder, { recursive: true });
    const line = 'A private area note, long enough for commit protection to notice it.';
    writeFileSync(join(folder, 'Notes.md'), `${line}\n`);
    expect(buildFingerprints(paths, company, {}).lineHashes).toContain(sha256(line));
  });

  it('names the branch after the ticket and the task', () => {
    const base = { id: 'abcdef12-3456', title: 'Fix the Último cambio!', source: undefined };
    expect(taskBranchName(base)).toBe('hatstand/fix-the-ultimo-cambio-abcdef12');
    expect(taskBranchName({ ...base, source: { kind: 'jira', key: 'ACME-12' } })).toBe('hatstand/acme-12-fix-the-ultimo-cambio-abcdef12');
  });
});
