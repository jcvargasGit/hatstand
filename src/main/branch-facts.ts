import { existsSync } from 'node:fs';
import type { BranchFact, Company, PullRequest, Task, TaskWorktree } from '../shared/schemas';
import { runGit, succeeds } from './worktrees';

const FETCH_TIMEOUT_MS = 20_000;
const NO_PROMPTS = { GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -oConnectTimeout=10' };

async function mainBranchRef(cwd: string, path: string): Promise<string | null> {
  const remote = await runGit(cwd, path, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => null);
  const candidates = [...(remote ? [remote] : []), 'origin/main', 'origin/master', 'main', 'master'];
  for (const candidate of candidates) {
    if (await succeeds(cwd, path, ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`])) return candidate;
  }
  return null;
}

async function isInMain(cwd: string, path: string, head: string, main: string, mayFetch: boolean): Promise<boolean> {
  if (await succeeds(cwd, path, ['merge-base', '--is-ancestor', head, main])) return true;
  if (!mayFetch || !main.startsWith('origin/')) return false;
  await runGit(cwd, path, ['fetch', '--quiet', 'origin', main.replace(/^origin\//, '')], NO_PROMPTS, FETCH_TIMEOUT_MS).catch(() => undefined);
  return succeeds(cwd, path, ['merge-base', '--is-ancestor', head, main]);
}

export async function readBranchFact(worktree: TaskWorktree, repoPath: string | undefined, path: string, mayFetch = false): Promise<BranchFact | null> {
  const copyExists = existsSync(worktree.path);
  const cwd = copyExists ? worktree.path : repoPath;
  if (!cwd || !existsSync(cwd)) return null;
  try {
    const head = await runGit(cwd, path, ['rev-parse', '--verify', copyExists ? 'HEAD' : `refs/heads/${worktree.branch}`]);
    const main = await mainBranchRef(cwd, path);
    const clean = copyExists ? (await runGit(cwd, path, ['status', '--porcelain'])) === '' : true;
    const hasWork = worktree.baseCommit ? head !== worktree.baseCommit : main !== null && Number(await runGit(cwd, path, ['rev-list', '--count', `${main}..${head}`])) > 0;
    const inMain = main !== null && hasWork && (await isInMain(cwd, path, head, main, mayFetch));
    return { projectId: worktree.projectId, hasWork, inMain, clean };
  } catch {
    return null;
  }
}

export async function readBranchFacts(task: Task, company: Company, pulls: PullRequest[], path: string): Promise<BranchFact[]> {
  const facts = await Promise.all(
    task.worktrees.map((worktree) => {
      const repoPath = company.projects.find((project) => project.id === worktree.projectId)?.path;
      return readBranchFact(worktree, repoPath, path, !pulls.some((pull) => pull.projectId === worktree.projectId));
    }),
  );
  return facts.filter((fact): fact is BranchFact => fact !== null);
}
