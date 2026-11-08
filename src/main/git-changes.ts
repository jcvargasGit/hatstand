import { execFile } from 'node:child_process';
import { lstat, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { FileChange, RepoChanges } from '../shared/api';
import type { Company, Task, TaskWorktree } from '../shared/schemas';
import { activeWorktrees, companyWithCode, taskRepositories } from './task-folders';
import { workRepositories } from '../shared/work-repos';

const run = promisify(execFile);
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_DIFF_CHARS = 400_000;
const MAX_UNTRACKED_BYTES = 1024 * 1024;
const MAX_CHANGES = 300;

const git = async (cwd: string, path: string, args: string[]) => {
  const { stdout } = await run('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args], {
    cwd,
    env: { ...process.env, PATH: path },
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  return stdout;
};

function changeStatus(code: string): FileChange['status'] {
  if (code === '??') return 'untracked';
  if (code.includes('D')) return 'deleted';
  if (code.includes('A')) return 'added';
  if (code.includes('R')) return 'renamed';
  return 'modified';
}

export function parseGitStatus(output: string): FileChange[] {
  const fields = output.split('\0').filter(Boolean);
  const changes: FileChange[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? '';
    const code = field.slice(0, 2);
    if (code.startsWith('R') || code.startsWith('C')) index += 1;
    changes.push({ path: field.slice(3), status: changeStatus(code) });
  }
  return changes;
}

export function parseNameStatus(output: string): FileChange[] {
  const fields = output.split('\0').filter(Boolean);
  const changes: FileChange[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const code = fields[index] ?? '';
    const hasOldName = code.startsWith('R') || code.startsWith('C');
    if (hasOldName) index += 1;
    index += 1;
    changes.push({ path: fields[index] ?? '', status: changeStatus(code) });
  }
  return changes;
}

const worktreeBase = (worktree: TaskWorktree | undefined) => worktree?.baseCommit ?? (worktree && worktree.base !== 'HEAD' ? worktree.base : null);

export async function committedChanges(repo: string, base: string, path: string): Promise<Pick<RepoChanges, 'committed' | 'commits'>> {
  try {
    const [names, count] = await Promise.all([
      git(repo, path, ['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', `${base}...HEAD`]),
      git(repo, path, ['rev-list', '--count', `${base}..HEAD`]),
    ]);
    return { committed: parseNameStatus(names).slice(0, MAX_CHANGES), commits: Number(count.trim()) || 0 };
  } catch {
    return { committed: [], commits: 0 };
  }
}

async function changedBefore(repo: string, file: string, agentStartedAt: string | null): Promise<boolean> {
  if (agentStartedAt === null) return true;
  try {
    return (await lstat(join(repo, file))).mtimeMs < Date.parse(agentStartedAt);
  } catch {
    return false;
  }
}

async function splitByAgentStart(repo: string, changes: FileChange[], agentStartedAt: string | null): Promise<Pick<RepoChanges, 'changes' | 'before'>> {
  const older = await Promise.all(changes.map((change) => changedBefore(repo, change.path, agentStartedAt)));
  return { changes: changes.filter((_, index) => !older[index]), before: changes.filter((_, index) => older[index]) };
}

export async function taskRepoChanges(realCompany: Company, task: Task, path: string, agentStartedAt: string | null): Promise<RepoChanges[]> {
  const company = companyWithCode(realCompany, task);
  const worktrees = activeWorktrees(realCompany, task);
  const selected = taskRepositories(company, task);
  const repos = task.isolated
    ? company.projects.filter((project) => worktrees.some((worktree) => worktree.projectId === project.id))
    : selected.length > 0
      ? selected
      : workRepositories(company);
  const reports = await Promise.all(
    repos.map(async (repo): Promise<RepoChanges> => {
      const base = worktreeBase(worktrees.find((worktree) => worktree.projectId === repo.id));
      const [changes, committed] = await Promise.all([repoChanges(repo.path, path), base ? committedChanges(repo.path, base, path) : { committed: [], commits: 0 }]);
      const split = task.isolated ? { changes: changes.changes, before: [] } : await splitByAgentStart(repo.path, changes.changes, agentStartedAt);
      return { projectId: repo.id, name: repo.name, path: repo.path, ...changes, ...split, ...committed };
    }),
  );
  return reports.filter((report) => report.isRepo && (report.changes.length > 0 || report.before.length > 0 || report.committed.length > 0));
}

export async function taskFileDiff(realCompany: Company, task: Task, projectId: string, file: string, path: string): Promise<string> {
  const repo = companyWithCode(realCompany, task).projects.find((project) => project.id === projectId);
  if (!repo) throw new Error('This repository is no longer part of this client.');
  const { changes } = await repoChanges(repo.path, path);
  if (changes.some((change) => change.path === file)) return fileDiff(repo.path, file, path);
  const base = worktreeBase(activeWorktrees(realCompany, task).find((worktree) => worktree.projectId === projectId));
  if (!base || !(await committedChanges(repo.path, base, path)).committed.some((change) => change.path === file)) throw new Error('This file no longer has changes.');
  return shortened(await git(repo.path, path, ['diff', '--no-ext-diff', '--no-textconv', `${base}...HEAD`, '--', file])) || 'No line changes to show.';
}

export async function repoChanges(repo: string, path: string): Promise<Pick<RepoChanges, 'branch' | 'changes' | 'isRepo' | 'truncated'>> {
  try {
    const [branch, status] = await Promise.all([
      git(repo, path, ['branch', '--show-current']),
      git(repo, path, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    ]);
    const changes = parseGitStatus(status);
    return { isRepo: true, branch: branch.trim() || null, changes: changes.slice(0, MAX_CHANGES), truncated: changes.length > MAX_CHANGES };
  } catch {
    return { isRepo: false, branch: null, changes: [], truncated: false };
  }
}

const shortened = (text: string) => (text.length > MAX_DIFF_CHARS ? `${text.slice(0, MAX_DIFF_CHARS)}\n\nThis diff is too long to show in full.` : text);

export async function fileDiff(repo: string, file: string, path: string): Promise<string> {
  const { changes } = await repoChanges(repo, path);
  const change = changes.find((item) => item.path === file);
  if (!change) throw new Error('This file no longer has changes.');
  if (change.status !== 'untracked') {
    const staged = await git(repo, path, ['diff', '--no-ext-diff', '--no-textconv', '--cached', '--', file]);
    const unstaged = await git(repo, path, ['diff', '--no-ext-diff', '--no-textconv', '--', file]);
    return shortened([staged, unstaged].filter(Boolean).join('\n')) || 'No line changes to show.';
  }
  const absolute = join(repo, file);
  if ((await stat(absolute)).size > MAX_UNTRACKED_BYTES) return 'This new file is over 1 MB. Open it in your editor instead.';
  const content = await readFile(absolute, 'utf8');
  if (content.includes('\0')) return 'This new file is binary.';
  return shortened(content.replace(/\n$/, '').split('\n').map((line) => `+${line}`).join('\n'));
}
