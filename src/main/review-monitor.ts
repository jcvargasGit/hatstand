import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { isReadyToMerge } from '../shared/review';
import type { PullRequest, Task, TaskReview } from '../shared/schemas';
import { readBranchFacts } from './branch-facts';
import { parseRemote, readFailureLog, readPull, reviewHost, type Fetcher, type RemoteRef, type ReviewHost } from './pull-requests';
import type { SecretStore } from './secrets';
import type { Store } from './store';
import { runGit } from './worktrees';

const POLL_MS = 90_000;
const FIRST_POLL_MS = 3_000;
const PARALLEL_CHECKS = 4;
const NO_TOKEN = 'Connect this client’s GitHub or GitLab in its settings to see pull requests.';

export function feedbackKey(pulls: PullRequest[]): string | undefined {
  const open = pulls.filter((pull) => pull.state === 'open' && (pull.failedChecks.length > 0 || pull.comments.length > 0));
  if (open.length === 0) return undefined;
  const facts = open.map((pull) => [pull.projectId, pull.number, pull.headSha, pull.failedChecks.map((check) => check.name), pull.comments.map((comment) => comment.id)]);
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex');
}

export function reviewNews(before: PullRequest[], after: PullRequest[]): string[] {
  return after.flatMap((pull) => {
    const previous = before.find((item) => item.projectId === pull.projectId && item.number === pull.number);
    const name = `${pull.repo} #${pull.number}`;
    if (!previous) return [];
    if (pull.state === 'merged' && previous.state !== 'merged') return [`${name} was merged`];
    if (pull.ci === 'failing' && previous.ci !== 'failing') return [`CI failed on ${name}`];
    if (pull.review === 'changes-requested' && previous.review !== 'changes-requested') return [`Changes were requested on ${name}`];
    if (isReadyToMerge(pull) && !isReadyToMerge(previous)) return [`${name} is ready to merge`];
    return [];
  });
}

type RepoTarget = { projectId: string; repo: string; worktree: string; recordedBranch: string; remote: RemoteRef; host: ReviewHost };

export type ReviewMonitorOptions = {
  store: Store;
  secrets: SecretStore;
  path: string;
  onChange: () => void;
  onNews: (task: Task, message: string) => void;
  fetcher?: Fetcher;
};

export class ReviewMonitor {
  private readonly reviews = new Map<string, TaskReview>();
  private timer: NodeJS.Timeout | undefined;
  private checking = false;

  constructor(private readonly options: ReviewMonitorOptions) {}

  start(): void {
    this.timer = setTimeout(() => void this.loop(), FIRST_POLL_MS);
  }

  stop(): void {
    clearTimeout(this.timer);
  }

  private async loop(): Promise<void> {
    await this.checkAll();
    this.timer = setTimeout(() => void this.loop(), POLL_MS);
  }

  all(): Record<string, TaskReview> {
    return Object.fromEntries(this.reviews);
  }

  get(taskId: string): TaskReview | undefined {
    return this.reviews.get(taskId);
  }

  private watchedTasks(): Task[] {
    return this.options.store
      .listCompanies()
      .filter((company) => !company.archivedAt)
      .flatMap((company) => this.options.store.listTasks(company.id))
      .filter((task) => task.isolated && task.worktrees.length > 0 && task.status !== 'done' && !task.archivedAt);
  }

  async checkAll(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      const pending = this.watchedTasks();
      const known = new Set(pending.map((task) => task.id));
      for (const id of this.reviews.keys()) if (!known.has(id)) this.reviews.delete(id);
      const workers = Array.from({ length: PARALLEL_CHECKS }, async () => {
        for (let task = pending.shift(); task; task = pending.shift()) await this.checkTask(task);
      });
      await Promise.all(workers);
    } finally {
      this.checking = false;
    }
  }

  async check(taskId: string): Promise<void> {
    await this.checkTask(this.options.store.findTask(taskId));
  }

  private async targets(task: Task): Promise<RepoTarget[]> {
    const company = this.options.store.readCompany(task.companyId);
    const secrets = this.options.secrets.read(company.id);
    const targets: RepoTarget[] = [];
    for (const worktree of task.worktrees) {
      if (!existsSync(worktree.path)) continue;
      const url = await runGit(worktree.path, this.options.path, ['remote', 'get-url', 'origin']).catch(() => null);
      const remote = url ? parseRemote(url) : null;
      if (!remote) continue;
      const host = reviewHost(remote, company.gitSource, secrets);
      if (!host) throw new Error(NO_TOKEN);
      const repo = company.projects.find((item) => item.id === worktree.projectId)?.name ?? remote.path;
      targets.push({ projectId: worktree.projectId, repo, worktree: worktree.path, recordedBranch: worktree.branch, remote, host });
    }
    return targets;
  }

  private async checkTask(task: Task): Promise<void> {
    const previous = this.reviews.get(task.id);
    const checkedAt = new Date().toISOString();
    let next: TaskReview;
    try {
      const pulls: PullRequest[] = [];
      for (const target of await this.targets(task)) {
        const current = await runGit(target.worktree, this.options.path, ['branch', '--show-current']).catch(() => '');
        const pull = await readPull(target.remote, current || target.recordedBranch, target.host, { projectId: target.projectId, repo: target.repo }, this.options.fetcher);
        if (pull) pulls.push(pull);
      }
      next = { pulls, checkedAt, feedbackKey: feedbackKey(pulls) };
      if (previous) reviewNews(previous.pulls, pulls).forEach((message) => this.options.onNews(task, message));
    } catch (error) {
      next = { pulls: previous?.pulls ?? [], feedbackKey: previous?.feedbackKey, checkedAt, error: error instanceof Error ? error.message : 'Could not read the pull request.' };
    }
    const company = this.options.store.readCompany(task.companyId);
    next = { ...next, branches: await readBranchFacts(task, company, next.pulls, this.options.path) };
    const changed = JSON.stringify({ ...previous, checkedAt: '' }) !== JSON.stringify({ ...next, checkedAt: '' });
    this.reviews.set(task.id, next);
    if (changed) this.options.onChange();
  }

  async failureLogs(task: Task): Promise<Map<string, string>> {
    const logs = new Map<string, string>();
    const pulls = this.reviews.get(task.id)?.pulls ?? [];
    for (const target of await this.targets(task)) {
      const checks = pulls.filter((pull) => pull.projectId === target.projectId).flatMap((pull) => pull.failedChecks);
      for (const check of checks) {
        if (!check.jobId) continue;
        const log = await readFailureLog(target.remote, target.host, check.jobId, this.options.fetcher);
        if (log) logs.set(`${target.projectId}:${check.jobId}`, log);
      }
    }
    return logs;
  }
}
