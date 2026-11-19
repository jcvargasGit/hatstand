// The terminals of task sessions: each runs an agent in a pty, and this keeps them in the live map.
// What the agent reports, the copies of the code it asks for, and the steps of the guide each have a
// module of their own next to this one, which this class composes.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import * as pty from 'node-pty';
import type { SessionOutput } from '../shared/api';
import type { Account, Company, Project, Session, SubagentRun, Task, TaskGuide, TaskWorktree } from '../shared/schemas';
import { claudeCode } from './agents/claude-code';
import { draftLengthAfter } from './agents/prompt-draft';
import { PromptPrefill } from './agents/prompt-prefill';
import { transcriptPathFrom } from './agents/agent-progress';
import { endRunningSubagents, parseSubagentActivity } from './agents/subagent-activity';
import { buildSystemPrompt, openingPrompt } from './agents/task-prompt';
import type { AgentAdapter } from './agents/types';
import { githubCopilot } from './agents/github-copilot';
import type { DataPaths } from './paths';
import type { SecretStore } from './secrets';
import { findExecutable } from './shell';
import { readClientInstructions } from './starter-files';
import { accountsForClient } from '../shared/accounts';
import { activeKnowledgeDir, activePlanning } from './active-folders';
import { backlogPromptInput } from './backlog-plan';
import { activeWorktrees, companyWithCode, reposOutside, sessionFolder, splitSessionFolders, taskArea, workingDirFor, taskFocus, taskFolderPaths, taskKnowledgeFolder, taskRepositories } from './task-folders';
import { areaFolder as areaFolderName } from '../shared/areas';
import { writePrivateFile, type Store } from './store';
import { SUMMARY_PROMPT } from './agents/summary-refresh';
import { DRAFT_IN_THE_WAY, summaryBlockedReason } from '../shared/task-summary';
import { workRepositories } from '../shared/work-repos';
import { TaskCopies } from './session-copies';
import { SessionGuides } from './session-guide';
import { SessionEnv, type FingerprintRefresher } from './session-env';
import { SessionChanges } from './session-changes';
import { answerPlanChecks, preparePlanChecks } from './session-plan-checks';
import { requireSession, SessionStates, type TrackedSession } from './session-state';

const MAX_BUFFER_CHARS = 400_000;
const STATUS_POLL_MS = 1000;
const ANSWERS_THE_AGENT = /[\r\d]/;
const SUBMIT_DELAY_MS = 300;
// Shift+Enter reaches the agent as ESC + Enter. It only adds a line, as in draftLengthAfter, so it answers nothing.
const SHIFT_ENTER = /\x1b\r/g;
const answersTheAgent = (data: string) => ANSWERS_THE_AGENT.test(data.replace(SHIFT_ENTER, ''));
const adapters: Record<Account['type'], AgentAdapter> = { 'claude-code': claudeCode, 'github-copilot': githubCopilot };

/** Whether the opening prompt of a first session can be sent without waiting: not when the step needs approval, or is one the person does. */
export function sendsOpeningByItself(task: Pick<Task, 'guide'>): boolean {
  if (!task.guide) return true;
  const step = task.guide.steps[task.guide.current];
  return step?.prompt !== undefined && step.approval !== true;
}

export function resolveAccount(accounts: Account[], defaultId: string | undefined, company: Company, task: Pick<Task, 'accountId'>): Account {
  const wanted = task.accountId ?? company.defaultAccountId ?? defaultId;
  const usable = accountsForClient(accounts, company.id);
  const account = usable.find((item) => item.id === wanted) ?? usable[0];
  if (!account) throw new Error('Add an agent account before starting a session.');
  return account;
}

const BUSY_FOR_PROMPT = 'The agent is busy or asking you something. Try again when it is waiting at its prompt.';

/** A running session. SessionStates keeps its tracked state up to date. */
type LiveSession = TrackedSession & { process: pty.IPty; buffer: string; emitted: number; watcher: NodeJS.Timeout; prefill: PromptPrefill | null; draftLength: number };

export type SessionEvents = {
  onData(sessionId: string, data: string, end: number): void;
  onChange(): void;
  onNeedsInput(session: Session): void;
};

export class SessionManager {
  private readonly live = new Map<string, LiveSession>();
  private readonly lastOutput = new Map<string, SessionOutput>();
  private readonly states: SessionStates;
  private readonly copies: TaskCopies;
  private readonly guides: SessionGuides;
  private readonly env: SessionEnv;
  private readonly changes: SessionChanges;

  constructor(
    private readonly paths: DataPaths,
    private readonly store: Store,
    private readonly secrets: SecretStore,
    private readonly shellPath: string,
    private readonly events: SessionEvents,
    protection: FingerprintRefresher,
  ) {
    mkdirSync(paths.runDir, { recursive: true, mode: 0o700 });
    this.changes = new SessionChanges(paths, store);
    const stateEvents = {
      onChange: () => events.onChange(),
      onNeedsInput: (session: Session) => events.onNeedsInput(session),
      onStateChange: (session: Session, previous: Session['state']) => this.changes.stateChanged(session, previous),
    };
    this.states = new SessionStates(paths, store, stateEvents, (sessionId) => this.live.get(sessionId));
    this.copies = new TaskCopies(paths, store, secrets, shellPath, events);
    this.env = new SessionEnv(paths, store, secrets, shellPath, protection);
    this.guides = new SessionGuides(paths, store, events, {
      offerToRunningSession: (taskId, prompt, busyMessage) => this.offerToRunningSession(taskId, prompt, busyMessage),
    });
  }

  /** Resolves when what the sessions of a task changed outside git is recorded. */
  outsideChangesSettled(taskId: string): Promise<void> {
    return this.changes.settled(taskId);
  }

  async createCopy(taskId: string, repo: Project): Promise<TaskWorktree> {
    return this.copies.create(taskId, repo);
  }

  async start(taskId: string, prompt?: string): Promise<Session> {
    const company = this.store.readCompany(this.store.findTask(taskId).companyId);
    const task = await this.copies.restore(this.store.findTask(taskId), company);
    const accounts = this.store.readAccounts();
    const account = resolveAccount(accounts.accounts, accounts.defaultAccountId, company, task);
    const now = new Date().toISOString();
    const isFirst = !this.store.listSessions().some((item) => item.taskId === taskId);
    const submitOpening = isFirst && prompt === undefined && this.store.readPreferences().autoSendPrompt && sendsOpeningByItself(task);
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
    this.launch(session, task, company, account, false, prompt, submitOpening);
    if (task.status === 'todo' || task.status === 'idea') this.store.updateTask(task.id, { status: 'doing' });
    return session;
  }

  resume(sessionId: string, prompt?: string): Session {
    if (this.live.has(sessionId)) return requireSession(this.store, sessionId);
    const previous = requireSession(this.store, sessionId);
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

  private launch(session: Session, task: Task, realCompany: Company, account: Account, resume: boolean, prompt?: string, submitOpening = false): void {
    const company = companyWithCode(realCompany, task);
    const adapter = adapters[account.type];
    const promptFile = this.paths.promptFile(session.id);
    const settingsFile = this.paths.settingsFile(session.id);
    const notesFile = this.paths.notesFile(company.id, task.id);
    const area = taskArea(company, task);
    const areaFolder = area ? this.paths.areaDir(company.id, areaFolderName(area)) : undefined;
    const knowledgeDirs = [activeKnowledgeDir(this.paths, company), ...(areaFolder ? [areaFolder] : [])];
    const planning = activePlanning(this.paths, company);
    const backlog = backlogPromptInput(this.store, this.paths, task);
    const repositories = backlog ? workRepositories(company) : taskRepositories(company, task);

    if (!existsSync(notesFile)) this.store.writeNotes(task, '');
    const reports = this.states.prepareSession(session);
    writePrivateFile(
      promptFile,
      buildSystemPrompt({
        company,
        task,
        area,
        repositories,
        subdomainFolders: taskFolderPaths(company, task),
        areaFolder,
        companyInstructions: readClientInstructions(company),
        knowledgeDirs,
        planning,
        notesFile,
        notes: this.store.readNotes(task),
        backlog,
      }),
    );

    const copies = this.copies.prepareSession(session.id, company, task, backlog !== undefined);
    const planChecks = backlog ? preparePlanChecks(this.paths, session.id) : null;
    const steps = this.guides.prepareSession(session.id);
    const pluginDir = company.context.pluginDir ?? (this.store.hasLocalPlugin(company.id) ? this.paths.pluginDir(company.id) : undefined);
    const sessionDir = this.paths.sessionDir(session.id);
    const folders = splitSessionFolders(this.paths.home, [
      ...knowledgeDirs,
      ...(pluginDir ? [pluginDir] : []),
      ...reposOutside(session.cwd, [...repositories, planning]),
      this.paths.tasksDir(company.id),
      ...(copies.copiesFolder ? [copies.copiesFolder] : []),
    ]);
    writePrivateFile(settingsFile, adapter.buildStatusSettings(folders.ownDirs));
    adapter.prepareSession?.({ sessionDir, promptFile, settingsFile });
    this.changes.prepareSession(session, [...folders.ownDirs, ...folders.addDirs]);
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
      ...folders,
    });
    const env = this.env.build({
      company,
      adapter,
      before: { ...copies.env, ...planChecks?.env },
      launchEnv: launch.env,
      after: { ...reports.env, ...steps.env },
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
    const opening = prompt ?? openingPrompt(task, taskFocus(company, task), resume, taskKnowledgeFolder(this.paths, company, task));
    let writtenAtPrompt = false;
    const writeOpening = (text: string) => {
      child.write(text);
      this.addToDraft(session.id, text);
      writtenAtPrompt = this.states.isAtItsPrompt(session.id);
    };
    const sendOpening = () => {
      if (writtenAtPrompt) this.submitOpening(session.id, child);
    };
    const prefill = opening === null ? null : new PromptPrefill(opening, writeOpening, submitOpening ? sendOpening : undefined);
    if (task.guide?.promptPending) this.store.updateTask(task.id, { guide: { ...task.guide, promptPending: false } });
    const live: LiveSession = {
      process: child,
      buffer: '',
      emitted: 0,
      watcher: setInterval(() => {
        this.states.poll(session.id);
        this.guides.pollStepsDone(session.id);
        if (copies.requestsFolder) this.copies.pollRequests(session, copies.requestsFolder);
        if (planChecks) answerPlanChecks(this.store, this.paths, session, planChecks.folder);
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
      this.guides.pollStepsDone(session.id);
      this.setDraftLength(session.id, 0);
      this.live.delete(session.id);
      this.lastOutput.set(session.id, { text: live.buffer, end: live.emitted });
      this.states.set(session.id, 'stopped');
    });
  }

  /** Sends the opening prompt of a first session, unless the session ended or the person cleared the prompt first. */
  private submitOpening(sessionId: string, child: pty.IPty): void {
    const live = this.live.get(sessionId);
    if (!live || live.process !== child || live.draftLength === 0 || !this.states.isAtItsPrompt(sessionId)) return;
    this.write(sessionId, '\r');
  }

  private setDraftLength(sessionId: string, length: number): void {
    const live = this.live.get(sessionId);
    if (!live) return;
    const changed = live.draftLength > 0 !== length > 0;
    live.draftLength = length;
    if (!changed) return;
    this.store.saveSession({ ...requireSession(this.store, sessionId), draft: length > 0 });
    this.events.onChange();
  }

  private addToDraft(sessionId: string, text: string): void {
    this.setDraftLength(sessionId, (this.live.get(sessionId)?.draftLength ?? 0) + text.length);
  }

  write(sessionId: string, data: string): void {
    const live = this.live.get(sessionId);
    // The answer is recorded before the agent can read it, so a quick reply from the agent is not overwritten.
    if (live && answersTheAgent(data)) this.states.markAnswered(sessionId);
    live?.process.write(data);
    live?.prefill?.onInput(data);
    if (live && live.state !== 'needs-input') this.setDraftLength(sessionId, draftLengthAfter(live.draftLength, data));
  }

  sendDraft(sessionId: string): void {
    const live = this.live.get(sessionId);
    if (!live) throw new Error('This session is not running.');
    this.states.poll(sessionId);
    if (live.state !== 'idle' && live.state !== 'background') throw new Error('The agent is busy or asking you something. Send your text when it is waiting at its prompt.');
    if (live.draftLength === 0) throw new Error('There is no text to send.');
    this.write(sessionId, '\r');
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
    this.guides.moveStep(taskId, index);
  }

  changeGuide(taskId: string, guide: TaskGuide): void {
    this.guides.change(taskId, guide);
  }

  async sendPrompt(taskId: string, prompt: string): Promise<void> {
    const sessions = this.store.listSessions().filter((item) => item.taskId === taskId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const running = sessions.find((item) => this.live.has(item.id));
    const live = running && this.live.get(running.id);
    if (running && live) {
      this.offerPrompt(running, live, prompt, BUSY_FOR_PROMPT);
      return;
    }
    const [latest] = sessions;
    if (latest && existsSync(latest.cwd)) this.resume(latest.id, prompt);
    else await this.start(taskId, prompt);
  }

  async refreshSummary(taskId: string): Promise<void> {
    const session = this.runningSession(taskId);
    const live = session && this.live.get(session.id);
    if (session) this.states.poll(session.id);
    const blocked = summaryBlockedReason(live?.state, Boolean(live?.prefill?.isWaiting) || (live?.draftLength ?? 0) > 0);
    if (!session || !live || blocked) throw new Error(blocked ?? 'Resume the session to update the TL;DR.');
    live.process.write(SUMMARY_PROMPT);
    await new Promise((resolve) => setTimeout(resolve, SUBMIT_DELAY_MS));
    if (this.live.get(session.id) !== live) return;
    live.process.write('\r');
  }

  private runningSession(taskId: string): Session | undefined {
    return this.store.listSessions().find((item) => item.taskId === taskId && this.live.has(item.id));
  }

  private offerToRunningSession(taskId: string, prompt: string | null, busyMessage: string): boolean {
    const session = this.runningSession(taskId);
    const live = session && this.live.get(session.id);
    if (!session || !live) return false;
    this.offerPrompt(session, live, prompt, busyMessage);
    return true;
  }

  /**
   * Gives a prompt to a running session: to the opening prompt still waiting to be typed, or typed at the
   * agent's prompt for the person to send. Never over text already in the terminal, nor while the agent is busy.
   */
  private offerPrompt(session: Session, live: LiveSession, prompt: string | null, busyMessage: string): void {
    if (live.draftLength > 0) throw new Error(DRAFT_IN_THE_WAY);
    if (live.prefill?.isWaiting) {
      live.prefill.retarget(prompt);
      return;
    }
    if (session.state !== 'idle' && session.state !== 'background') throw new Error(busyMessage);
    if (prompt !== null) {
      live.process.write(prompt);
      this.addToDraft(session.id, prompt);
    }
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
