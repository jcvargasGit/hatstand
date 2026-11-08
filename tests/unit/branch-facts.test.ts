import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readBranchFact } from '../../src/main/branch-facts';
import type { TaskWorktree } from '../../src/shared/schemas';

const path = process.env.PATH ?? '';
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd, encoding: 'utf8' }).trim();

describe('what git says about the copy of a task', () => {
  let root: string;
  let repo: string;
  let copy: string;
  let worktree: TaskWorktree;

  const commit = (cwd: string, file: string) => {
    writeFileSync(join(cwd, file), file);
    git(cwd, 'add', '.');
    git(cwd, 'commit', '-m', file);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'branch-facts-'));
    repo = join(root, 'repo');
    copy = join(root, 'copy');
    execFileSync('git', ['init', '-b', 'main', repo]);
    commit(repo, 'first.txt');
    const baseCommit = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'worktree', 'add', '-b', 'task', copy, baseCommit);
    worktree = { projectId: 'p', path: copy, branch: 'task', base: 'HEAD', baseCommit };
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('sees no work in a branch without commits, even though it is in main', async () => {
    expect(await readBranchFact(worktree, repo, path)).toEqual({ projectId: 'p', hasWork: false, inMain: false, clean: true });
  });

  it('sees changes not committed', async () => {
    writeFileSync(join(copy, 'draft.txt'), 'x');
    expect(await readBranchFact(worktree, repo, path)).toMatchObject({ hasWork: false, clean: false });
  });

  it('sees commits that are not in main yet', async () => {
    commit(copy, 'work.txt');
    expect(await readBranchFact(worktree, repo, path)).toEqual({ projectId: 'p', hasWork: true, inMain: false, clean: true });
  });

  it('sees a local merge without a remote or a pull request', async () => {
    commit(copy, 'work.txt');
    git(repo, 'merge', '--no-ff', '-m', 'merge', 'task');
    expect(await readBranchFact(worktree, repo, path)).toEqual({ projectId: 'p', hasWork: true, inMain: true, clean: true });
  });

  it('still reads the branch after its copy was removed', async () => {
    commit(copy, 'work.txt');
    git(repo, 'merge', '--no-ff', '-m', 'merge', 'task');
    git(repo, 'worktree', 'remove', copy);
    expect(await readBranchFact(worktree, repo, path)).toEqual({ projectId: 'p', hasWork: true, inMain: true, clean: true });
  });

  it('gives no fact when the branch is gone', async () => {
    git(repo, 'worktree', 'remove', copy);
    git(repo, 'branch', '-D', 'task');
    expect(await readBranchFact(worktree, repo, path)).toBeNull();
  });

  it('sees main moved on the remote by fetching it when allowed', async () => {
    const origin = join(root, 'origin.git');
    execFileSync('git', ['clone', '--bare', repo, origin]);
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'fetch', 'origin');
    commit(copy, 'work.txt');
    git(copy, 'push', 'origin', 'task');
    git(origin, 'update-ref', 'refs/heads/main', 'refs/heads/task');
    expect(await readBranchFact(worktree, repo, path)).toMatchObject({ inMain: false });
    expect(await readBranchFact(worktree, repo, path, true)).toMatchObject({ inMain: true });
  });
});
