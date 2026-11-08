import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { Company, Project, Task, TaskWorktree } from '../shared/schemas';
import type { DataPaths } from './paths';
import { slugify } from './store';

const exec = promisify(execFile);
const FETCH_TIMEOUT_MS = 20_000;
const MAX_SLUG_LENGTH = 40;

export async function runGit(cwd: string, path: string, args: string[], env: Record<string, string> = {}, timeout?: number): Promise<string> {
  const { stdout } = await exec('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args], {
    cwd,
    env: { ...process.env, PATH: path, ...env },
    maxBuffer: 4 * 1024 * 1024,
    timeout,
  });
  return stdout.trim();
}

export const succeeds = async (cwd: string, path: string, args: string[]) => {
  try {
    await runGit(cwd, path, args);
    return true;
  } catch {
    return false;
  }
};

export function taskBranchName(task: Pick<Task, 'id' | 'title' | 'source'>): string {
  const name = task.source ? `${task.source.key} ${task.title}` : task.title;
  const slug = slugify(name).slice(0, MAX_SLUG_LENGTH).replace(/-$/, '');
  return `hatstand/${slug}-${task.id.slice(0, 8)}`;
}

async function canIsolate(repo: Project, path: string): Promise<boolean> {
  if (!existsSync(repo.path)) return false;
  const prefix = await runGit(repo.path, path, ['rev-parse', '--show-prefix']).catch(() => null);
  return prefix === '' && (await succeeds(repo.path, path, ['rev-parse', '--verify', 'HEAD']));
}

async function defaultBase(repo: string, path: string, networkEnv: Record<string, string>): Promise<string> {
  const remote = await runGit(repo, path, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => null);
  const candidates = remote ? [remote] : ['origin/main', 'origin/master'];
  for (const candidate of candidates) {
    if (!(await succeeds(repo, path, ['rev-parse', '--verify', '--quiet', candidate]))) continue;
    const branch = candidate.replace(/^origin\//, '');
    await runGit(repo, path, ['fetch', '--quiet', 'origin', branch], { GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -oConnectTimeout=10', ...networkEnv }, FETCH_TIMEOUT_MS).catch(() => undefined);
    return candidate;
  }
  return 'HEAD';
}

function folderFor(repo: Project, others: TaskWorktree[], parent: string): string {
  const name = slugify(basename(repo.path));
  const taken = others.some((worktree) => worktree.path === join(parent, name));
  return join(parent, taken ? `${name}-${repo.id.slice(0, 8)}` : name);
}

async function createWorktree(repo: Project, target: string, branch: string, path: string, networkEnv: Record<string, string>): Promise<{ base: string; baseCommit?: string }> {
  await runGit(repo.path, path, ['worktree', 'prune']);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  if (await succeeds(repo.path, path, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])) {
    await runGit(repo.path, path, ['worktree', 'add', target, branch]);
    return { base: branch };
  }
  const base = await defaultBase(repo.path, path, networkEnv);
  const baseCommit = await runGit(repo.path, path, ['rev-parse', '--verify', `${base}^{commit}`]);
  await runGit(repo.path, path, ['worktree', 'add', '--no-track', '-b', branch, target, baseCommit]);
  return { base, baseCommit };
}

export type PrepareOptions = { paths: DataPaths; company: Company; task: Task; repos: Project[]; path: string; networkEnv?: Record<string, string> };

export async function prepareWorktrees({ paths, company, task, repos, path, networkEnv = {} }: PrepareOptions): Promise<TaskWorktree[]> {
  const parent = paths.taskWorktreesDir(company.id, task.id);
  const branch = taskBranchName(task);
  const worktrees = [...task.worktrees];
  for (const repo of repos) {
    const known = worktrees.find((item) => item.projectId === repo.id);
    if (known && existsSync(known.path)) continue;
    if (!(await canIsolate(repo, path))) continue;
    const target = known?.path ?? folderFor(repo, worktrees, parent);
    const wanted = known?.branch ?? branch;
    try {
      const created = await createWorktree(repo, target, wanted, path, networkEnv);
      worktrees.splice(known ? worktrees.indexOf(known) : worktrees.length, known ? 1 : 0, { projectId: repo.id, path: target, branch: wanted, base: known?.base ?? created.base, baseCommit: known?.baseCommit ?? created.baseCommit });
    } catch (error) {
      const reason = error instanceof Error ? error.message.split('\n').find((line) => line.startsWith('fatal')) : null;
      throw new Error(`Could not create a copy of ${repo.name} for this task${reason ? `: ${reason}` : '.'} Choose Shared folder in the task details to work without one.`);
    }
  }
  return worktrees;
}

export type RemoveReport = { removed: string[]; kept: { name: string; reason: string }[] };

export async function removeWorktrees(company: Company, task: Task, path: string): Promise<RemoveReport> {
  const report: RemoveReport = { removed: [], kept: [] };
  for (const worktree of task.worktrees) {
    const repo = company.projects.find((item) => item.id === worktree.projectId);
    const name = repo?.name ?? basename(worktree.path);
    if (!existsSync(worktree.path)) {
      report.removed.push(worktree.path);
      continue;
    }
    if (!repo || !existsSync(repo.path)) {
      report.kept.push({ name, reason: `The original repository is gone. Check ${worktree.path} and delete it by hand if you no longer need it.` });
      continue;
    }
    try {
      await runGit(repo.path, path, ['worktree', 'remove', worktree.path]);
      report.removed.push(worktree.path);
    } catch {
      report.kept.push({ name, reason: `${worktree.path} has files that are not committed. Commit or discard them first.` });
    }
  }
  const parents = new Set(task.worktrees.map((worktree) => dirname(worktree.path)));
  for (const parent of parents) {
    if (existsSync(parent) && readdirSync(parent).length === 0) rmdirSync(parent);
  }
  return report;
}

export const keptMessage = (report: RemoveReport) => report.kept.map((item) => `${item.name}: ${item.reason}`).join(' ');
