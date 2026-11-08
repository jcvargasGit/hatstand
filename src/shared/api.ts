import type { PastFolderRecord } from './schemas';
import type { ReleaseState } from './schemas';
import type { BacklogPlan, BacklogPlanInput } from './backlog-plan';
import type { Account, AccountsFile, Company, GitSource, Idea, NewTask, Playbook, Session, StayAwakeMode, SubagentRun, Task, TaskPatch, TaskReview, TodayLayout, Subdomain, GitIdentityInput } from './schemas';

export type Snapshot = {
  companies: Company[];
  accounts: AccountsFile;
  tasks: Task[];
  sessions: Session[];
  reviews: Record<string, TaskReview>;
  todayLayout: TodayLayout;
  guideNewTasks: boolean;
  localKnowledge: string[];
  localPlugin: string[];
  starterInstructions: string[];
  clientFolders: Record<string, { knowledge: string; llmConfig: string; planning: string; defaultRoot: string }>;
};

export type RepoCandidate = { name: string; path: string };

export type RemoteRepo = {
  path: string;
  description: string;
  cloneUrl: string;
  archived: boolean;
};

export type CloneProgress = {
  path: string;
  state: 'cloning' | 'cloned' | 'existing' | 'failed';
  error?: string;
};

export type AgentStatus = {
  installed: boolean;
  signedIn: boolean;
  email?: string;
  plan?: string;
};

export type HookState = 'protected' | 'missing' | 'existing-hook' | 'managed-elsewhere' | 'not-git';

export type RepoGuardStatus = {
  name: string;
  path: string;
  state: HookState;
  reason?: string;
};

export type GuardReport = {
  installed: string[];
  skipped: { path: string; reason: string }[];
  knowledgeLines: number;
  secrets: number;
};

export type ClientFileScope = 'llm-config' | 'knowledge' | 'guides' | 'planning' | 'areas';
export type ClientFolderSection = PastFolderRecord['section'];

export type PastFolder = {
  path: string;
  leftAt: string;
  exists: boolean;
};

export type FolderSwitchImpact = {
  from: string;
  files: number;
  openTasks: number;
};

export type GitIdentityPreview = {
  folder: string;
  file: string;
  preview: string;
  addsRule: boolean;
  existingFile?: string;
};

export type GitIdentityRepoCheck = {
  name: string;
  path: string;
  email: string | null;
  covered: boolean;
  matches: boolean;
};

export type GitIdentityStatus = {
  suggested: { name: string; email: string; githubUser: string; folder: string };
  repos: GitIdentityRepoCheck[];
};

export type StayAwakeStatus = { mode: StayAwakeMode; active: boolean };

export type ReleaseStatus = {
  state: ReleaseState['state'] | 'idle';
  version?: string;
  message?: string;
  installedVersion: string | null;
  mainVersion: string | null;
  commitsOutsideMain: number;
};

export type FileChange = { path: string; status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' };

export type RepoChanges = {
  projectId: string;
  name: string;
  path: string;
  isRepo: boolean;
  branch: string | null;
  changes: FileChange[];
  before: FileChange[];
  committed: FileChange[];
  commits: number;
  truncated: boolean;
};

export type SearchResult =
  | { kind: 'task'; taskId: string; companyId: string; title: string; client: string; snippet?: string; path?: undefined }
  | { kind: 'client'; companyId: string; title: string; client: string; snippet?: undefined; path?: undefined }
  | { kind: 'repo'; companyId: string; title: string; client: string; path: string; snippet?: undefined }
  | { kind: 'file'; companyId: string; title: string; client: string; path: string; scope: ClientFileScope; snippet?: string };

export type SearchReport = { results: SearchResult[]; partial: boolean };

export type SessionOutput = { text: string; end: number };

export type ClientFile = {
  path: string;
  name: string;
  folder: string;
  scope: ClientFileScope;
};

export type TaskOutput = {
  name: string;
  updatedAt: string;
};

export type ClientFileContent = {
  content: string;
};

export type PlaybookSummary = Playbook & {
  id: string;
  origin: 'built-in' | 'customized' | 'client';
  file?: string;
};

export type PlaybookList = {
  playbooks: PlaybookSummary[];
  problems: string[];
};

export type RepoLayout = {
  tool: string | null;
  isMonorepo: boolean;
  folders: string[];
};

export type ClientRemovalReport = {
  keptFilesIn?: string;
  protectionRemoved: string[];
  protectionKept: string[];
};

export type TrackerSyncReport = {
  added: number;
  updated: number;
  checked: string[];
  errors: string[];
};

export type BacklogPlanReport =
  | { state: 'missing' }
  | { state: 'invalid'; problems: string[] }
  | { state: 'valid'; plan: BacklogPlan; approvedAt: string | null; changedAfterApproval: boolean };

export type HatstandApi = {
  getSnapshot(): Promise<Snapshot>;
  createCompany(name: string, color: string, origin?: Company['origin']): Promise<Company>;
  connectGitSource(companyId: string, source: GitSource, token?: string): Promise<RemoteRepo[]>;
  downloadRepos(companyId: string, baseDir: string, repoPaths: string[]): Promise<CloneProgress[]>;
  checkAgent(accountId: string): Promise<AgentStatus>;
  startAgentSignIn(accountId: string): Promise<string>;
  saveCompany(company: Company): Promise<Company>;
  resetClientFolder(companyId: string): Promise<void>;
  inspectRepoLayout(companyId: string, projectId: string): Promise<RepoLayout>;
  setPlanningRepo(companyId: string, path: string): Promise<void>;
  createPlanningRepo(companyId: string, path: string): Promise<void>;
  defaultPlanningFolder(companyId: string): Promise<string>;
  listPlanningFolders(companyId: string): Promise<string[]>;
  archiveClient(companyId: string): Promise<void>;
  restoreClient(companyId: string): Promise<void>;
  removeClient(companyId: string, deleteFiles: boolean): Promise<ClientRemovalReport>;
  setClientPhoto(companyId: string, link: string): Promise<void>;
  removeClientPhoto(companyId: string): Promise<void>;
  readClientPhoto(companyId: string): Promise<string | null>;
  saveAccount(account: Account): Promise<void>;
  removeAccount(accountId: string): Promise<void>;
  setDefaultAccount(accountId: string): Promise<void>;
  createTask(input: NewTask): Promise<Task>;
  updateTask(taskId: string, patch: TaskPatch): Promise<Task>;
  linkTaskIssue(taskId: string, reference: string): Promise<Task>;
  unlinkTaskIssue(taskId: string): Promise<Task>;
  openTaskWorktree(taskId: string, projectId: string): Promise<void>;
  deleteTask(taskId: string): Promise<void>;
  readNotes(taskId: string): Promise<string>;
  readTaskNote(taskId: string): Promise<string>;
  saveTaskNote(taskId: string, note: string): Promise<void>;
  refreshTaskSummary(taskId: string): Promise<void>;
  openTaskNotesInEditor(taskId: string): Promise<string>;
  listTaskOutputs(taskId: string): Promise<TaskOutput[]>;
  readTaskOutput(taskId: string, name: string): Promise<string>;
  openTaskOutputInEditor(taskId: string, name: string): Promise<string>;
  listSecretNames(companyId: string): Promise<string[]>;
  setSecret(companyId: string, name: string, value: string): Promise<void>;
  deleteSecret(companyId: string, name: string): Promise<void>;
  importEnvFile(companyId: string): Promise<number>;
  openClientFolder(companyId: string, folder: ClientFolderSection | 'instructions'): Promise<void>;
  folderSwitchImpact(companyId: string, section: ClientFolderSection): Promise<FolderSwitchImpact>;
  listPastFolders(companyId: string, section: ClientFolderSection): Promise<PastFolder[]>;
  isPluginFolder(path: string): Promise<boolean>;
  pickDirectory(title: string): Promise<string | null>;
  pickFile(title: string): Promise<string | null>;
  resolvePath(path: string, kind: 'directory' | 'file'): Promise<string>;
  scanRepos(dir: string): Promise<RepoCandidate[]>;
  isInsideGitRepo(path: string): Promise<boolean>;
  startSession(taskId: string): Promise<Session>;
  resumeSession(sessionId: string): Promise<Session>;
  stopSession(sessionId: string): Promise<void>;
  writeSession(sessionId: string, data: string): Promise<void>;
  sendDraft(sessionId: string): Promise<void>;
  resizeSession(sessionId: string, cols: number, rows: number): Promise<void>;
  readSessionBuffer(sessionId: string): Promise<string>;
  readSessionOutput(sessionId: string): Promise<SessionOutput>;
  listClientFiles(companyId: string): Promise<ClientFile[]>;
  readClientFile(companyId: string, path: string): Promise<ClientFileContent>;
  listPlaybooks(companyId: string): Promise<PlaybookList>;
  customizePlaybook(companyId: string, playbookId: string): Promise<string>;
  createPlaybook(companyId: string, name: string): Promise<string>;
  removePlaybook(companyId: string, playbookId: string): Promise<void>;
  setTaskGuide(taskId: string, playbookId: string | null): Promise<void>;
  moveGuideStep(taskId: string, index: number): Promise<void>;
  readSubagents(sessionId: string): Promise<SubagentRun[]>;
  guardStatus(companyId: string): Promise<RepoGuardStatus[]>;
  installGuard(companyId: string, keepExistingHooks?: string[]): Promise<GuardReport>;
  syncTrackers(companyId: string): Promise<TrackerSyncReport>;
  getStayAwake(): Promise<StayAwakeStatus>;
  setStayAwake(mode: StayAwakeMode): Promise<void>;
  getReleaseStatus(): Promise<ReleaseStatus | null>;
  startRelease(): Promise<void>;
  setClientOrder(companyIds: string[]): Promise<void>;
  setTodayLayout(layout: TodayLayout): Promise<void>;
  setGuideNewTasks(enabled: boolean): Promise<void>;
  searchEverything(query: string): Promise<SearchReport>;
  createDocument(companyId: string, where: string, name: string): Promise<string>;
  planningStatus(companyId: string): Promise<RepoChanges | null>;
  taskChanges(taskId: string): Promise<RepoChanges[]>;
  taskFileDiff(taskId: string, projectId: string, file: string): Promise<string>;
  openInEditor(companyId: string, path: string): Promise<void>;
  detectEditor(): Promise<string | null>;
  openClientInEditor(companyId: string): Promise<string>;
  openTaskInEditor(taskId: string): Promise<string>;
  openClientFileInEditor(companyId: string, path: string): Promise<string>;
  removeTaskCopies(taskId: string): Promise<void>;
  refreshReviews(taskId?: string): Promise<void>;
  giveFeedbackToAgent(taskId: string): Promise<void>;
  addIdeas(companyId: string, ideas: Idea[]): Promise<void>;
  reorderTasks(taskIds: string[]): Promise<void>;
  openLink(url: string): Promise<void>;
  createArea(companyId: string, name: string): Promise<Subdomain>;
  deleteArea(companyId: string, areaId: string): Promise<void>;
  openAreaInEditor(companyId: string, areaId: string): Promise<void>;
  gitIdentityStatus(companyId: string): Promise<GitIdentityStatus>;
  previewGitIdentity(companyId: string, identity: GitIdentityInput): Promise<GitIdentityPreview>;
  applyGitIdentity(companyId: string, identity: GitIdentityInput): Promise<GitIdentityStatus>;
  planBacklog(companyId: string, taskIds: string[]): Promise<Task>;
  readBacklogPlan(taskId: string): Promise<BacklogPlanReport>;
  saveBacklogPlan(taskId: string, plan: BacklogPlanInput): Promise<BacklogPlanReport>;
  setBacklogPlanApproval(taskId: string, approved: boolean): Promise<BacklogPlanReport>;
};

export type HatstandEvents = {
  'session-data': { sessionId: string; data: string; end: number };
  'state-changed': null;
  'clone-progress': CloneProgress & { companyId: string };
};

export type Bridge = {
  invoke<M extends keyof HatstandApi>(
    method: M,
    ...args: Parameters<HatstandApi[M]>
  ): ReturnType<HatstandApi[M]>;
  on<E extends keyof HatstandEvents>(
    event: E,
    listener: (payload: HatstandEvents[E]) => void,
  ): () => void;
};
