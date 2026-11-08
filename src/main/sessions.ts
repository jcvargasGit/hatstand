import { randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as pty from 'node-pty';
import type { SessionOutput } from '../shared/api';
import type { Account, Company, Project, Session, SessionState, SubagentRun, Task, TaskGuide, TaskWorktree } from '../shared/schemas';
import { claudeCode } from './agents/claude-code';
import { draftLengthAfter } from './agents/prompt-draft';
import { PromptPrefill } from './agents/prompt-prefill';
import { readAgentProgress, readTranscriptTail, sessionStateFrom, transcriptPathFrom, type AgentProgress } from './agents/agent-progress';
import { endRunningSubagents, parseSubagentActivity, SESSION_RESTART_LINE } from './agents/subagent-activity';
import { buildStepPrompt, buildSystemPrompt, openingPrompt } from './agents/task-prompt';
import { ACTIVITY_FILE_ENV, reportedStates, STATUS_FILE_ENV, WAITING_AT_PROMPT, type AgentAdapter } from './agents/types';
import { buildAgentEnv } from './env';
import { githubCopilot } from './agents/github-copilot';
import { hideSecrets, sessionGitEnv } from './git-credentials';
import type { DataPaths } from './paths';
import type { SecretStore } from './secrets';
import { findExecutable } from './shell';
import { isStarterInstructions } from './starter-files';
import { accountsForClient } from '../shared/accounts';
import { COPY_REQUESTS_ENV, EDIT_REPO_TOOL, READ_ONLY_REPOS_ENV } from './edit-repo-tool';
import { parseStepDone, STEP_DONE_TOOL, STEP_FILE_ENV } from './step-done-tool';
import { refreshFingerprints } from './guard/service';
import { identityEnv } from './git-identity';
import { activeKnowledgeDir, activePlanning } from './active-folders';
import { answerPlanCheck, backlogPromptInput } from './backlog-plan';
import { CHECK_PLAN_TOOL, PLAN_CHECKS_ENV } from './check-plan-tool';
import { activeWorktrees, companyWithCode, reposOutside, sessionFolder, taskArea, workingDirFor, taskFocus, taskFolderPaths, taskRepositories } from './task-folders';
import { prepareWorktrees } from './worktrees';
import { gitTokenName } from '../shared/git-source';
import { areaFolder as areaFolderName } from '../shared/areas';
import { writePrivateFile, type Store } from './store';
import { SUMMARY_PROMPT } from './agents/summary-refresh';
import { DRAFT_IN_THE_WAY, summaryBlockedReason } from '../shared/task-summary';
import { repoToCopy, workRepositories } from '../shared/work-repos';

const MAX_BUFFER_CHARS = 400_000;
const STATUS_POLL_MS = 1000;
const TRANSCRIPT_RECHECK_MS = 15_000;
const TRANSCRIPT_MIN_READ_MS = 2_000;
const ANSWERS_THE_AGENT = /[\r\d]/;
const SUBMIT_DELAY_MS = 300;
// Shift+Enter reaches the agent as ESC + Enter. It only adds a line, as in draftLengthAfter, so it answers nothing.
const SHIFT_ENTER = /\x1b\r/g;
const answersTheAgent = (data: string) => ANSWERS_THE_AGENT.test(data.replace(SHIFT_ENTER, ''));
const adapters: Record<Account['type'], AgentAdapter> = { 'claude-code': claudeCode, 'github-copilot': githubCopilot };

export function resolveAccount(accounts: Account[], defaultId: string | undefined, company: Company, task: Task): Account {
  const wanted = task.accountId ?? company.defaultAccountId ?? defaultId;
  const usable = accountsForClient(accounts, company.id);
  const account = usable.find((item) => item.id === wanted) ?? usable[0];
  if (!account) throw new Error('Add an agent account before starting a session.');
  return account;
}

type TurnCheck = { modifiedAt: number; checkedAt: number; progress: AgentProgress };
type LiveSession = { process: pty.IPty; buffer: string; emitted: number; watcher: NodeJS.Timeout; prefill: PromptPrefill | null; startedAt: number; turnCheck: TurnCheck | null; state: SessionState; draftLength: number };

export type SessionEvents = {
  onData(sessionId: string, data: string, end: number): void;
  onChange(): void;
  onNeedsInput(session: Session): void;
};

export class SessionManager {
  private readonly live = new Map<string, LiveSession>();
  private readonly lastOutput = new Map<string, SessionOutput>();
  private readonly answeringCopies = new Set<string>();

  constructor(
    private readonly paths: DataPaths,
    private readonly store: Store,
    private readonly secrets: SecretStore,
    private readonly shellPath: string,
    private readonly events: SessionEvents,
  ) {
    mkdirSync(paths.runDir, { recursive: true, mode: 0o700 });
  }

  private async copyRepos(task: Task, company: Company, repos: Project[]): Promise<TaskWorktree[]> {
    const secrets = this.secrets.read(company.id);
    const token = company.gitSource ? secrets[gitTokenName(company.gitSource.provider)] : undefined;
    const networkEnv = { ...sessionGitEnv(company.gitSource, secrets), ...(company.gitSource && token ? { [gitTokenName(company.gitSource.provider)]: token } : {}) };
    return prepareWorktrees({ paths: this.paths, company, task, repos, path: this.shellPath, networkEnv });
  }

  private originalRepoFolders(companyId: string): string[] {
    return workRepositories(this.store.readCompany(companyId)).filter((repo) => existsSync(repo.path)).map((repo) => realpathSync(repo.path));
  }

  private async restoreCopies(task: Task, company: Company): Promise<Task> {
    if (!task.isolated || task.worktrees.length === 0) return task;
    const repos = company.projects.filter((repo) => task.worktrees.some((worktree) => worktree.projectId === repo.id));
    return this.store.setTaskCode(task.id, await this.copyRepos(task, company, repos));
  }

  async createCopy(taskId: string, repo: Project): Promise<TaskWorktree> {
    const task = this.store.findTask(taskId);
    const company = this.store.readCompany(task.companyId);
    const worktrees = await this.copyRepos(task, company, [repo]);
    const worktree = worktrees.find((item) => item.projectId === repo.id);
    if (!worktree) throw new Error(`${repo.name} cannot have its own copy. It needs to be the top folder of a git repository, with at least one commit. To change it anyway, choose Shared folder in the task details.`);
    this.store.setTaskCode(task.id, worktrees, [...new Set([...task.projectIds, repo.id])]);
    this.events.onChange();
    return worktree;
  }

  private pollPlanChecks(session: Session, folder: string): void {
    if (!existsSync(folder)) return;
    for (const request of readdirSync(folder).filter((name) => name.endsWith('.request'))) {
      const file = join(folder, request);
      const reply = file.slice(0, -'.request'.length);
      rmSync(file);
      try {
        const { ok, text } = answerPlanCheck(this.store, this.paths, session.taskId);
        writePrivateFile(`${reply}.${ok ? 'ok' : 'error'}`, text);
      } catch (error) {
        writePrivateFile(`${reply}.error`, `${error instanceof Error ? error.message : 'The plan could not be checked.'}\n`);
      }
    }
  }

  private async answerCopyRequest(session: Session, repoName: string): Promise<string> {
    const company = this.store.readCompany(session.companyId);
    const repo = repoToCopy(company, repoName);
    const worktree = await this.createCopy(session.taskId, repo);
    return `Your copy of ${repo.name} is ready.\nFolder: ${worktree.path}\nBranch: ${worktree.branch}\nWork and commit only in that folder.\n`;
  }

  private pollCopyRequests(session: Session, folder: string): void {
    if (this.answeringCopies.has(session.id) || !existsSync(folder)) return;
    const [request] = readdirSync(folder).filter((name) => name.endsWith('.request'));
    if (!request) return;
    const file = join(folder, request);
    const reply = file.slice(0, -'.request'.length);
    const repoName = readFileSync(file, 'utf8').trim();
    rmSync(file);
    this.answeringCopies.add(session.id);
    void this.answerCopyRequest(session, repoName)
      .then(
        (text) => writePrivateFile(`${reply}.ok`, text),
        (error: unknown) => writePrivateFile(`${reply}.error`, `${error instanceof Error ? error.message : 'The copy could not be created.'}\n`),
      )
      .finally(() => this.answeringCopies.delete(session.id));
  }

  async start(taskId: string, prompt?: string): Promise<Session> {
    const company = this.store.readCompany(this.store.findTask(taskId).companyId);
    const task = await this.restoreCopies(this.store.findTask(taskId), company);
    const accounts = this.store.readAccounts();
    const account = resolveAccount(accounts.accounts, accounts.defaultAccountId, company, task);
    const now = new Date().toISOString();
    const session: Session = {
      id: randomUUID(),
      taskId,
      companyId: company.id,
      accountId: account.id,
      cwd: sessionFolder(activeWorktrees(company, task)) ?? workingDirFor(this.paths, company, task),
      state: 'idle',
      startedAt: now,
      updatedAt: now,
    };
    this.launch(session, task, company, account, false, prompt);
    if (task.status === 'todo' || task.status === 'idea') this.store.updateTask(task.id, { status: 'doing' });
    return session;
  }

  resume(sessionId: string, prompt?: string): Session {
    if (this.live.has(sessionId)) return this.requireSession(sessionId);
    const previous = this.requireSession(sessionId);
    const task = this.store.findTask(previous.taskId);
    const company = this.store.readCompany(previous.companyId);
    const account = this.store.readAccounts().accounts.find((item) => item.id === previous.accountId);
    if (!account) throw new Error('The agent account used by this session was removed.');
    if (!existsSync(previous.cwd)) throw new Error('The folder of this session is gone. Start a new session.');
    const session: Session = { ...previous, state: 'idle', draft: false, updatedAt: new Date().toISOString() };
    this.launch(session, task, company, account, this.hasConversation(sessionId), prompt);
    return session;
  }

  private hasConversation(sessionId: string): boolean {
    const activityFile = this.paths.activityFile(sessionId);
    if (!existsSync(activityFile)) return true;
    const transcript = transcriptPathFrom(readFileSync(activityFile, 'utf8'));
    return !transcript || existsSync(transcript);
  }

  private launch(session: Session, task: Task, realCompany: Company, account: Account, resume: boolean, prompt?: string): void {
    const company = companyWithCode(realCompany, task);
    const adapter = adapters[account.type];
    const statusFile = this.paths.statusFile(session.id);
    const promptFile = this.paths.promptFile(session.id);
    const settingsFile = this.paths.settingsFile(session.id);
    const activityFile = this.paths.activityFile(session.id);
    const notesFile = this.paths.notesFile(company.id, task.id);
    const area = taskArea(company, task);
    const areaFolder = area ? this.paths.areaDir(company.id, areaFolderName(area)) : undefined;
    const knowledgeDirs = [activeKnowledgeDir(this.paths, company), ...(areaFolder ? [areaFolder] : [])];
    const planning = activePlanning(this.paths, company);
    const backlog = backlogPromptInput(this.store, this.paths, task);
    const repositories = backlog ? workRepositories(company) : taskRepositories(company, task);
    const canAskForCopies = !backlog && task.isolated && workRepositories(company).length > 0;

    if (!existsSync(notesFile)) this.store.writeNotes(task, '');
    writePrivateFile(statusFile, session.state);
    writePrivateFile(settingsFile, adapter.buildStatusSettings());
    if (existsSync(activityFile)) appendFileSync(activityFile, SESSION_RESTART_LINE);
    else writePrivateFile(activityFile, '');
    writePrivateFile(
      promptFile,
      buildSystemPrompt({
        company,
        task,
        area,
        repositories,
        subdomainFolders: taskFolderPaths(company, task),
        areaFolder,
        companyInstructions: this.readInstructions(company),
        knowledgeDirs,
        planning,
        notesFile,
        notes: this.store.readNotes(task),
        backlog,
      }),
    );

    const copiesFolder = canAskForCopies ? this.paths.taskWorktreesDir(company.id, task.id) : null;
    if (copiesFolder) mkdirSync(copiesFolder, { recursive: true, mode: 0o700 });
    const pluginDir = company.context.pluginDir ?? (this.store.hasLocalPlugin(company.id) ? this.paths.pluginDir(company.id) : undefined);
    const sessionDir = this.paths.sessionDir(session.id);
    adapter.prepareSession?.({ sessionDir, promptFile, settingsFile });
    const launch = adapter.buildLaunch({
      account,
      company: { ...company, context: { ...company.context, pluginDir } },
      task,
      sessionId: session.id,
      sessionDir,
      notesFile,
      resume,
      promptFile,
      settingsFile,
      addDirs: [...knowledgeDirs, ...(pluginDir ? [pluginDir] : []), ...reposOutside(session.cwd, [...repositories, planning]), this.paths.tasksDir(company.id), ...(copiesFolder ? [copiesFolder] : [])],
    });
    const copyRequests = this.paths.copyRequestsDir(session.id);
    if (canAskForCopies) {
      mkdirSync(copyRequests, { recursive: true, mode: 0o700 });
      writePrivateFile(this.paths.editRepoTool, EDIT_REPO_TOOL);
      chmodSync(this.paths.editRepoTool, 0o700);
    }
    const planChecks = backlog ? this.paths.planChecksDir(session.id) : null;
    if (planChecks) {
      mkdirSync(planChecks, { recursive: true, mode: 0o700 });
      writePrivateFile(this.paths.checkPlanTool, CHECK_PLAN_TOOL);
      chmodSync(this.paths.checkPlanTool, 0o700);
    }
    const originalsReadOnly = canAskForCopies || backlog !== undefined;
    writePrivateFile(this.paths.stepDoneTool, STEP_DONE_TOOL);
    chmodSync(this.paths.stepDoneTool, 0o700);
    const secrets = this.secrets.read(company.id);
    refreshFingerprints(this.paths, this.store.readCompany(company.id), secrets);
    const hiddenSecrets = adapter.hiddenSecrets ?? [];
    const env = buildAgentEnv({
      base: process.env,
      path: `${this.paths.toolsDir}:${this.shellPath}`,
      secrets: hideSecrets(secrets, hiddenSecrets),
      extra: { ...sessionGitEnv(company.gitSource, secrets, hiddenSecrets), ...identityEnv(company.gitIdentity), ...(canAskForCopies ? { [COPY_REQUESTS_ENV]: copyRequests } : {}), ...(originalsReadOnly ? { [READ_ONLY_REPOS_ENV]: JSON.stringify(this.originalRepoFolders(task.companyId)) } : {}), ...(planChecks ? { [PLAN_CHECKS_ENV]: planChecks } : {}), ...launch.env, [STATUS_FILE_ENV]: statusFile, [ACTIVITY_FILE_ENV]: activityFile, [STEP_FILE_ENV]: this.paths.stepFile(session.id) },
    });

    const executable = findExecutable(launch.command, this.shellPath);
    if (!executable) {
      throw new Error(`${launch.command} was not found on your PATH. Install it and sign in, then start the session again.`);
    }
    const child = pty.spawn(executable, launch.args, {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: session.cwd,
      env,
    });
    const opening = prompt ?? openingPrompt(task, taskFocus(company, task), resume);
    const prefill = opening === null ? null : new PromptPrefill(opening, (text) => {
      child.write(text);
      this.addToDraft(session.id, text);
    });
    if (task.guide?.promptPending) this.store.updateTask(task.id, { guide: { ...task.guide, promptPending: false } });
    const live: LiveSession = {
      process: child,
      buffer: '',
      emitted: 0,
      watcher: setInterval(() => {
        this.pollStatus(session.id);
        this.pollStepDone(session.id);
        if (canAskForCopies) this.pollCopyRequests(session, copyRequests);
        if (planChecks) this.pollPlanChecks(session, planChecks);
      }, STATUS_POLL_MS),
      prefill,
      startedAt: Date.now(),
      turnCheck: null,
      state: session.state,
      draftLength: 0,
    };
    this.live.set(session.id, live);
    this.store.saveSession(session);
    this.events.onChange();

    child.onData((data) => {
      live.buffer = (live.buffer + data).slice(-MAX_BUFFER_CHARS);
      live.emitted += data.length;
      prefill?.onOutput(data);
      this.events.onData(session.id, data, live.emitted);
    });
    child.onExit(() => {
      prefill?.cancel();
      clearInterval(live.watcher);
      this.pollStepDone(session.id);
      this.setDraftLength(session.id, 0);
      this.live.delete(session.id);
      this.lastOutput.set(session.id, { text: live.buffer, end: live.emitted });
      this.setState(session.id, 'stopped');
    });
  }

  private readInstructions(company: Company): string {
    const file = company.context.instructionsFile;
    const text = file && existsSync(file) ? readFileSync(file, 'utf8') : '';
    return isStarterInstructions(text) ? '' : text;
  }

  private pollStatus(sessionId: string): void {
    const file = this.paths.statusFile(sessionId);
    if (!existsSync(file)) return;
    const reported = readFileSync(file, 'utf8').trim();
    if (reported === WAITING_AT_PROMPT) {
      writePrivateFile(file, 'idle');
      const state = this.stateFromAgent(sessionId, 'idle');
      this.setState(sessionId, state);
      if (state === 'idle') this.events.onNeedsInput(this.requireSession(sessionId));
      return;
    }
    const state = reportedStates.find((item) => item === reported);
    if (state) this.setState(sessionId, this.stateFromAgent(sessionId, state));
  }

  private pollStepDone(sessionId: string): void {
    const file = this.paths.stepFile(sessionId);
    const stepDone = existsSync(file) ? parseStepDone(readFileSync(file, 'utf8')) : undefined;
    const session = this.requireSession(sessionId);
    if (session.stepDone === stepDone) return;
    this.store.saveSession({ ...session, stepDone });
    this.events.onChange();
  }

  private clearStepDone(taskId: string): void {
    for (const session of this.store.listSessions().filter((item) => item.taskId === taskId)) {
      rmSync(this.paths.stepFile(session.id), { force: true });
      if (session.stepDone !== undefined) this.store.saveSession({ ...session, stepDone: undefined });
    }
  }

  private setDraftLength(sessionId: string, length: number): void {
    const live = this.live.get(sessionId);
    if (!live) return;
    const changed = live.draftLength > 0 !== length > 0;
    live.draftLength = length;
    if (!changed) return;
    this.store.saveSession({ ...this.requireSession(sessionId), draft: length > 0 });
    this.events.onChange();
  }

  private addToDraft(sessionId: string, text: string): void {
    this.setDraftLength(sessionId, (this.live.get(sessionId)?.draftLength ?? 0) + text.length);
  }

  private stateFromAgent(sessionId: string, reported: SessionState): SessionState {
    const live = this.live.get(sessionId);
    const activityFile = this.paths.activityFile(sessionId);
    if (!live || reported === 'needs-input' || !existsSync(activityFile)) return reported;
    try {
      const transcript = transcriptPathFrom(readFileSync(activityFile, 'utf8'));
      if (!transcript || !existsSync(transcript)) return reported;
      const modifiedAt = statSync(transcript).mtimeMs;
      const now = Date.now();
      const check = live.turnCheck;
      const elapsed = check ? now - check.checkedAt : Infinity;
      const isCurrent = check && (check.modifiedAt === modifiedAt ? elapsed < TRANSCRIPT_RECHECK_MS : elapsed < TRANSCRIPT_MIN_READ_MS);
      const progress = isCurrent ? check.progress : readAgentProgress(readTranscriptTail(transcript), live.startedAt, now);
      if (!isCurrent) live.turnCheck = { modifiedAt, checkedAt: now, progress };
      return sessionStateFrom(reported, progress, now - modifiedAt);
    } catch {
      return reported;
    }
  }

  private setState(sessionId: string, state: SessionState): void {
    const live = this.live.get(sessionId);
    if (live) live.state = state;
    const session = this.requireSession(sessionId);
    if (session.state === state) return;
    const updated = { ...session, state, updatedAt: new Date().toISOString() };
    this.store.saveSession(updated);
    if (state === 'idle' || state === 'background' || state === 'stopped') this.store.applyAgentStatus(session.taskId);
    this.events.onChange();
    if (state === 'needs-input') this.events.onNeedsInput(updated);
  }

  private requireSession(sessionId: string): Session {
    const session = this.store.listSessions().find((item) => item.id === sessionId);
    if (!session) throw new Error(`Session ${sessionId} no longer exists.`);
    return session;
  }

  write(sessionId: string, data: string): void {
    const live = this.live.get(sessionId);
    live?.process.write(data);
    live?.prefill?.onInput(data);
    if (live && live.state !== 'needs-input') this.setDraftLength(sessionId, draftLengthAfter(live.draftLength, data));
    if (live && answersTheAgent(data)) this.markAnswered(sessionId);
  }

  sendDraft(sessionId: string): void {
    const live = this.live.get(sessionId);
    if (!live) throw new Error('This session is not running.');
    this.pollStatus(sessionId);
    if (live.state !== 'idle' && live.state !== 'background') throw new Error('The agent is busy or asking you something. Send your text when it is waiting at its prompt.');
    if (live.draftLength === 0) throw new Error('There is no text to send.');
    this.write(sessionId, '\r');
  }

  private markAnswered(sessionId: string): void {
    const file = this.paths.statusFile(sessionId);
    if (existsSync(file) && readFileSync(file, 'utf8').trim() === 'needs-input') writePrivateFile(file, 'working');
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.live.get(sessionId)?.process.resize(cols, rows);
  }

  readBuffer(sessionId: string): string {
    return this.readOutput(sessionId).text;
  }

  readOutput(sessionId: string): SessionOutput {
    const live = this.live.get(sessionId);
    if (live) return { text: live.buffer, end: live.emitted };
    return this.lastOutput.get(sessionId) ?? { text: '', end: 0 };
  }

  stop(sessionId: string): void {
    this.live.get(sessionId)?.process.kill();
  }

  readSubagents(sessionId: string): SubagentRun[] {
    const file = this.paths.activityFile(sessionId);
    if (!existsSync(file)) return [];
    const runs = parseSubagentActivity(readFileSync(file, 'utf8'));
    return this.live.has(sessionId) ? runs : endRunningSubagents(runs);
  }

  moveGuideStep(taskId: string, index: number): void {
    const { guide } = this.store.findTask(taskId);
    if (!guide?.steps[index]) throw new Error('This step no longer exists in the guide.');
    this.changeGuide(taskId, { ...guide, current: index });
  }

  changeGuide(taskId: string, guide: TaskGuide): void {
    const task = { ...this.store.findTask(taskId), guide };
    const company = this.store.readCompany(task.companyId);
    const prompt = buildStepPrompt(task, taskFocus(company, task));
    const session = this.store.listSessions().find((item) => item.taskId === taskId && this.live.has(item.id));
    const live = session && this.live.get(session.id);
    if (!session || !live) {
      this.clearStepDone(taskId);
      this.store.updateTask(taskId, { guide: { ...guide, promptPending: prompt !== null } });
      return;
    }
    if (live.draftLength > 0) throw new Error(DRAFT_IN_THE_WAY);
    if (live.prefill?.isWaiting) {
      live.prefill.retarget(prompt);
    } else {
      if (session.state !== 'idle' && session.state !== 'background') throw new Error('The agent is busy or asking you something. Change step when it is waiting at its prompt.');
      if (prompt !== null) {
        live.process.write(prompt);
        this.addToDraft(session.id, prompt);
      }
    }
    this.clearStepDone(taskId);
    this.store.updateTask(taskId, { guide: { ...guide, promptPending: false } });
    this.events.onChange();
  }

  async sendPrompt(taskId: string, prompt: string): Promise<void> {
    const sessions = this.store.listSessions().filter((item) => item.taskId === taskId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const running = sessions.find((item) => this.live.has(item.id));
    const live = running && this.live.get(running.id);
    if (running && live) {
      if (live.draftLength > 0) throw new Error(DRAFT_IN_THE_WAY);
      if (live.prefill?.isWaiting) live.prefill.retarget(prompt);
      else if (running.state === 'idle' || running.state === 'background') {
        live.process.write(prompt);
        this.addToDraft(running.id, prompt);
      } else throw new Error('The agent is busy or asking you something. Try again when it is waiting at its prompt.');
      return;
    }
    const [latest] = sessions;
    if (latest && existsSync(latest.cwd)) this.resume(latest.id, prompt);
    else await this.start(taskId, prompt);
  }

  async refreshSummary(taskId: string): Promise<void> {
    const session = this.store.listSessions().find((item) => item.taskId === taskId && this.live.has(item.id));
    const live = session && this.live.get(session.id);
    if (session) this.pollStatus(session.id);
    const blocked = summaryBlockedReason(live?.state, Boolean(live?.prefill?.isWaiting) || (live?.draftLength ?? 0) > 0);
    if (!session || !live || blocked) throw new Error(blocked ?? 'Resume the session to update the TL;DR.');
    live.process.write(SUMMARY_PROMPT);
    await new Promise((resolve) => setTimeout(resolve, SUBMIT_DELAY_MS));
    if (this.live.get(session.id) !== live) return;
    live.process.write('\r');
  }

  hasLiveClientSession(companyId: string): boolean {
    return this.store.listSessions().some((session) => session.companyId === companyId && this.live.has(session.id));
  }

  hasLiveSession(taskId: string): boolean {
    return this.store.listSessions().some((session) => session.taskId === taskId && this.live.has(session.id));
  }

  liveCount(): number {
    return this.live.size;
  }

  stopAll(): void {
    for (const live of this.live.values()) {
      clearInterval(live.watcher);
      live.process.kill();
    }
    this.live.clear();
    this.store.markAllSessionsStopped();
  }
}
