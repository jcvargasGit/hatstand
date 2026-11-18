// The copies of the code a task works in, and the requests a running agent makes for a new one.
// The agent asks through hatstand-edit-repo, which leaves a .request file and waits for a .ok or .error reply.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { gitTokenName } from '../shared/git-source';
import type { Company, Project, Session, Task, TaskWorktree } from '../shared/schemas';
import { repoToCopy, workRepositories } from '../shared/work-repos';
import { COPY_REQUESTS_ENV, EDIT_REPO_TOOL, READ_ONLY_REPOS_ENV } from './edit-repo-tool';
import { sessionGitEnv } from './git-credentials';
import type { DataPaths } from './paths';
import type { SecretStore } from './secrets';
import { writePrivateFile, type Store } from './store';
import { prepareWorktrees } from './worktrees';

/** What a session gets from this module when it starts. */
export type CopySetup = {
  /** The folder of the task's copies, which the agent may read. Null when the agent cannot ask for copies. */
  copiesFolder: string | null;
  /** The folder the agent leaves its requests in, to poll while the session runs. Null when it cannot ask. */
  requestsFolder: string | null;
  env: Record<string, string>;
};

/** An agent may ask for copies when its task has copies of its own and the client has repositories to copy. A backlog plan only reads the code. */
export function canAskForCopies(company: Company, task: Pick<Task, 'isolated'>, plansBacklog: boolean): boolean {
  return !plansBacklog && task.isolated && workRepositories(company).length > 0;
}

export class TaskCopies {
  /** Sessions whose copy request is being answered. Copying takes a while, and a session asks for one copy at a time. */
  private readonly answering = new Set<string>();

  constructor(
    private readonly paths: DataPaths,
    private readonly store: Store,
    private readonly secrets: Pick<SecretStore, 'read'>,
    private readonly shellPath: string,
    private readonly events: { onChange(): void },
  ) {}

  /**
   * Prepares a session to ask for copies, when it may: the folders, and hatstand-edit-repo on the PATH.
   * An agent that works in copies, or only plans, gets the original repositories as read only.
   */
  prepareSession(sessionId: string, company: Company, task: Task, plansBacklog: boolean): CopySetup {
    const canAsk = canAskForCopies(company, task, plansBacklog);
    const copiesFolder = canAsk ? this.paths.taskWorktreesDir(company.id, task.id) : null;
    const requestsFolder = canAsk ? this.paths.copyRequestsDir(sessionId) : null;
    if (copiesFolder && requestsFolder) {
      mkdirSync(copiesFolder, { recursive: true, mode: 0o700 });
      mkdirSync(requestsFolder, { recursive: true, mode: 0o700 });
      writePrivateFile(this.paths.editRepoTool, EDIT_REPO_TOOL);
      chmodSync(this.paths.editRepoTool, 0o700);
    }
    const originalsReadOnly = canAsk || plansBacklog;
    return {
      copiesFolder,
      requestsFolder,
      env: {
        ...(requestsFolder ? { [COPY_REQUESTS_ENV]: requestsFolder } : {}),
        ...(originalsReadOnly ? { [READ_ONLY_REPOS_ENV]: JSON.stringify(this.originalRepoFolders(task.companyId)) } : {}),
      },
    };
  }

  /** The real folders of the client's repositories, which the agent of a task with its own copies may only read. */
  originalRepoFolders(companyId: string): string[] {
    return workRepositories(this.store.readCompany(companyId)).filter((repo) => existsSync(repo.path)).map((repo) => realpathSync(repo.path));
  }

  /** Makes again the copies a task had, such as after they were removed, before its session starts. */
  async restore(task: Task, company: Company): Promise<Task> {
    if (!task.isolated || task.worktrees.length === 0) return task;
    const repos = company.projects.filter((repo) => task.worktrees.some((worktree) => worktree.projectId === repo.id));
    return this.store.setTaskCode(task.id, await this.copyRepos(task, company, repos));
  }

  async create(taskId: string, repo: Project): Promise<TaskWorktree> {
    const task = this.store.findTask(taskId);
    const company = this.store.readCompany(task.companyId);
    const worktrees = await this.copyRepos(task, company, [repo]);
    const worktree = worktrees.find((item) => item.projectId === repo.id);
    if (!worktree) throw new Error(`${repo.name} cannot have its own copy. It needs to be the top folder of a git repository, with at least one commit. To change it anyway, choose Shared folder in the task details.`);
    this.store.setTaskCode(task.id, worktrees, [...new Set([...task.projectIds, repo.id])]);
    this.events.onChange();
    return worktree;
  }

  /** Answers the next copy request the agent of the session left in the folder, unless one is being answered already. */
  pollRequests(session: Session, folder: string): void {
    if (this.answering.has(session.id) || !existsSync(folder)) return;
    const [request] = readdirSync(folder).filter((name) => name.endsWith('.request'));
    if (!request) return;
    const file = join(folder, request);
    const reply = file.slice(0, -'.request'.length);
    const repoName = readFileSync(file, 'utf8').trim();
    rmSync(file);
    this.answering.add(session.id);
    void this.answer(session, repoName)
      .then(
        (text) => writePrivateFile(`${reply}.ok`, text),
        (error: unknown) => writePrivateFile(`${reply}.error`, `${error instanceof Error ? error.message : 'The copy could not be created.'}\n`),
      )
      .finally(() => this.answering.delete(session.id));
  }

  private async answer(session: Session, repoName: string): Promise<string> {
    const company = this.store.readCompany(session.companyId);
    const repo = repoToCopy(company, repoName);
    const worktree = await this.create(session.taskId, repo);
    return `Your copy of ${repo.name} is ready.\nFolder: ${worktree.path}\nBranch: ${worktree.branch}\nWork and commit only in that folder.\n`;
  }

  private async copyRepos(task: Task, company: Company, repos: Project[]): Promise<TaskWorktree[]> {
    const secrets = this.secrets.read(company.id);
    const token = company.gitSource ? secrets[gitTokenName(company.gitSource.provider)] : undefined;
    const networkEnv = { ...sessionGitEnv(company.gitSource, secrets), ...(company.gitSource && token ? { [gitTokenName(company.gitSource.provider)]: token } : {}) };
    return prepareWorktrees({ paths: this.paths, company, task, repos, path: this.shellPath, networkEnv });
  }
}
