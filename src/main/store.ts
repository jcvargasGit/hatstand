import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import type { Snapshot, TaskOutput } from '../shared/api';
import {
  accountsFileSchema,
  companySchema,
  newTaskSchema,
  sessionSchema,
  taskPatchSchema,
  taskSchema,
  type Account,
  type AccountsFile,
  type Company,
  type NewTask,
  type Session,
  type Task,
  type TaskPatch,
  type TaskSource,
  type TaskStatus,
  type TaskWorktree, subdomainSchema, type Subdomain, type BacklogPlanLink } from '../shared/schemas';
import { preferencesSchema, type Preferences } from '../shared/schemas';
import { parseTaskNotes, withNotesStatus } from '../shared/task-notes';
import type { DataPaths } from './paths';
import type { DownloadedPhoto } from './photos';
import { isStarterInstructions, KNOWLEDGE_README, STARTER_INSTRUCTIONS } from './starter-files';
import { countFolderFiles, withFolderHistory } from './active-folders';
import { withFolderPointer } from './folder-pointer';
import { defaultClientFolder } from './task-folders';
import { areaFolder, defaultArea, placeAreaFolders, withCoreArea } from '../shared/areas';
import { slugify } from '../shared/slug';

export { slugify };

const PRIVATE_DIR = 0o700;
const PRIVATE_FILE = 0o600;

const IN_PROGRESS = 'in progress';

export function withDoneDate(before: Task, after: Task, now = new Date().toISOString()): Task {
  if (after.status !== 'done') return { ...after, doneAt: undefined };
  return before.status === 'done' ? after : { ...after, doneAt: now };
}

export function withBacklogPlace(before: Task, after: Task, clientTasks: Task[]): Task {
  if (after.status !== 'idea' || before.status === 'idea') return after;
  const ranks = clientTasks.flatMap((task) => (task.id !== after.id && task.rank !== undefined ? [task.rank] : []));
  return { ...after, rank: Math.max(-1, ...ranks) + 1, boardLane: undefined };
}

export const AREA_STARTER_FILES = {
  'Instructions.md': '# Instructions\n\nHow this area works: what is expected, its rules and what to avoid. Agents read this file.\n',
  'Notes.md': '# Notes\n\nWhat you have learned, and what is pending.\n',
  'Tips.md': '# Tips\n\nShortcuts and things that saved you time.\n',
};

export function writePrivateFile(path: string, content: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true, mode: PRIVATE_DIR });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, content, { mode: PRIVATE_FILE });
  renameSync(temporary, path);
  chmodSync(path, PRIVATE_FILE);
}

function hasVisibleEntries(dir: string, ignored: string[] = []): boolean {
  return existsSync(dir) && readdirSync(dir).some((name) => !name.startsWith('.') && !ignored.includes(name));
}

function listFiles(dir: string, extension: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith(extension));
}

function withProjectIds(raw: { projectId?: string; projectIds?: string[] }): unknown {
  return raw.projectId && !raw.projectIds ? { ...raw, projectIds: [raw.projectId] } : raw;
}

const COUNTER_LOCK_WAIT_MS = 5000;
const COUNTER_LOCK_STALE_MS = 10000;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isStale(lock: string): boolean {
  try {
    return Date.now() - statSync(lock).mtimeMs > COUNTER_LOCK_STALE_MS;
  } catch {
    return false;
  }
}

export function withFileLock<T>(lock: string, work: () => T, waitMs = COUNTER_LOCK_WAIT_MS): T {
  const deadline = Date.now() + waitMs;
  while (true) {
    try {
      closeSync(openSync(lock, 'wx', PRIVATE_FILE));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (isStale(lock)) rmSync(lock, { force: true });
      else if (Date.now() > deadline) throw new Error('Another Hatstand window is creating a task. Try again.');
      else sleepSync(20);
    }
  }
  try {
    return work();
  } finally {
    rmSync(lock, { force: true });
  }
}

const DEFAULT_ACCOUNTS: AccountsFile = {
  defaultAccountId: 'claude-default',
  accounts: [{ id: 'claude-default', name: 'Claude Code', type: 'claude-code', label: 'personal' }],
};

const orderRank = (order: string[], id: string) => {
  const rank = order.indexOf(id);
  return rank === -1 ? order.length : rank;
};

export class Store {
  constructor(private readonly paths: DataPaths) {
    mkdirSync(paths.home, { recursive: true, mode: PRIVATE_DIR });
    chmodSync(paths.home, PRIVATE_DIR);
  }

  snapshot(): Snapshot {
    const companies = this.listCompanies();
    return {
      companies,
      accounts: this.readAccounts(),
      tasks: companies.flatMap((company) => this.listTasks(company.id)),
      sessions: this.listSessions(),
      reviews: {},
      todayLayout: this.readPreferences().todayLayout,
      guideNewTasks: this.readPreferences().guideNewTasks,
      localKnowledge: companies.filter((company) => this.hasLocalKnowledge(company.id)).map((company) => company.id),
      localPlugin: companies.filter((company) => this.hasLocalPlugin(company.id)).map((company) => company.id),
      starterInstructions: companies.filter((company) => this.usesStarterInstructions(company)).map((company) => company.id),
      clientFolders: Object.fromEntries(
        companies.map((company) => [
          company.id,
          { knowledge: this.paths.knowledgeDir(company.id), llmConfig: this.paths.pluginDir(company.id), planning: this.paths.planningDir(company.id), defaultRoot: defaultClientFolder(company) },
        ]),
      ),
    };
  }

  private hasLocalKnowledge(companyId: string): boolean {
    return hasVisibleEntries(this.paths.knowledgeDir(companyId), ['README.md']);
  }

  usesStarterInstructions(company: Company): boolean {
    const file = company.context.instructionsFile;
    return Boolean(file) && existsSync(file as string) && isStarterInstructions(readFileSync(file as string, 'utf8'));
  }

  hasLocalPlugin(companyId: string): boolean {
    return countFolderFiles(this.paths.pluginDir(companyId)) > 0;
  }

  syncFolderPointers(company: Company): void {
    const sections = [
      { folder: this.paths.knowledgeDir(company.id), custom: company.context.knowledgeDir },
      { folder: this.paths.pluginDir(company.id), custom: company.context.pluginDir },
      { folder: this.paths.planningDir(company.id), custom: company.planning?.path },
    ];
    for (const { folder, custom } of sections) {
      const file = join(folder, 'README.md');
      const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
      const next = withFolderPointer(text, custom && resolve(custom) !== resolve(folder) ? custom : undefined);
      if (next === text) continue;
      if (next) writePrivateFile(file, next);
      else rmSync(file);
    }
  }

  ensureClientFolders(companyId: string): void {
    mkdirSync(this.paths.knowledgeDir(companyId), { recursive: true, mode: PRIVATE_DIR });
    mkdirSync(this.paths.skillsDir(companyId), { recursive: true, mode: PRIVATE_DIR });
    mkdirSync(this.paths.planningDir(companyId), { recursive: true, mode: PRIVATE_DIR });
    if (!existsSync(this.paths.pluginManifest(companyId))) {
      writePrivateFile(
        this.paths.pluginManifest(companyId),
        JSON.stringify({ name: companyId, version: '0.0.1', description: `LLM config for ${companyId}` }, null, 2),
      );
    }
  }

  readAccounts(): AccountsFile {
    if (!existsSync(this.paths.accountsFile)) return DEFAULT_ACCOUNTS;
    return accountsFileSchema.parse(parse(readFileSync(this.paths.accountsFile, 'utf8')));
  }

  saveAccount(account: Account): void {
    const file = this.readAccounts();
    const accounts = file.accounts.some((item) => item.id === account.id)
      ? file.accounts.map((item) => (item.id === account.id ? account : item))
      : [...file.accounts, account];
    this.writeAccounts({ ...file, accounts });
  }

  removeAccount(accountId: string): void {
    const file = this.readAccounts();
    const accounts = file.accounts.filter((item) => item.id !== accountId);
    const shared = accounts.filter((item) => !item.companyId);
    if (shared.length === 0) throw new Error('Keep at least one agent account that every client can use.');
    const defaultAccountId =
      file.defaultAccountId === accountId ? shared[0]?.id : file.defaultAccountId;
    this.writeAccounts({ defaultAccountId, accounts });
  }

  removeAccountsOfCompany(companyId: string): void {
    const file = this.readAccounts();
    this.writeAccounts({ ...file, accounts: file.accounts.filter((item) => item.companyId !== companyId) });
  }

  setDefaultAccount(accountId: string): void {
    if (this.readAccounts().accounts.find((item) => item.id === accountId)?.companyId) {
      throw new Error('An account for one client cannot be the default for every client.');
    }
    this.writeAccounts({ ...this.readAccounts(), defaultAccountId: accountId });
  }

  private writeAccounts(file: AccountsFile): void {
    writePrivateFile(this.paths.accountsFile, stringify(accountsFileSchema.parse(file)));
  }

  listCompanies(): Company[] {
    if (!existsSync(this.paths.companiesDir)) return [];
    const { clientOrder } = this.readPreferences();
    return readdirSync(this.paths.companiesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(this.paths.companyFile(entry.name)))
      .map((entry) => this.readCompany(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .sort((a, b) => orderRank(clientOrder, a.id) - orderRank(clientOrder, b.id));
  }

  readPreferences(): Preferences {
    if (!existsSync(this.paths.preferencesFile)) return preferencesSchema.parse({});
    return preferencesSchema.parse(parse(readFileSync(this.paths.preferencesFile, 'utf8')) ?? {});
  }

  savePreferences(change: Partial<Preferences>): Preferences {
    const next = preferencesSchema.parse({ ...this.readPreferences(), ...change });
    writePrivateFile(this.paths.preferencesFile, stringify(next));
    return next;
  }

  readCompany(companyId: string): Company {
    return companySchema.parse(parse(readFileSync(this.paths.companyFile(companyId), 'utf8')));
  }

  createCompany(name: string, color: string, origin: Company['origin'] = 'existing'): Company {
    const base = slugify(name);
    const taken = new Set(this.listCompanies().map((company) => company.id));
    let id = base;
    for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`;
    this.ensureClientFolders(id);
    const company = companySchema.parse({ id, name, color, origin });
    return this.saveCompany(origin === 'scratch' ? this.addStarterFiles(company) : company);
  }

  private addStarterFiles(company: Company): Company {
    const instructionsFile = this.paths.instructionsFile(company.id);
    writePrivateFile(instructionsFile, STARTER_INSTRUCTIONS);
    writePrivateFile(join(this.paths.knowledgeDir(company.id), 'README.md'), KNOWLEDGE_README);
    return { ...company, context: { ...company.context, instructionsFile } };
  }

  createArea(companyId: string, name: string): Subdomain {
    const company = this.readCompany(companyId);
    const area = subdomainSchema.parse({ id: randomUUID(), name });
    const saved = this.saveCompany({ ...company, subdomains: [...company.subdomains, area] });
    return saved.subdomains.find((item) => item.id === area.id) ?? area;
  }

  defaultAreaId(companyId: string): string {
    const company = this.readCompany(companyId);
    const area = defaultArea(company) ?? defaultArea(this.saveCompany(company));
    if (!area) throw new Error(`${company.name} has no default area.`);
    return area.id;
  }

  ensureAreaFolders(company: Company): void {
    for (const area of company.subdomains) {
      const folder = this.paths.areaDir(company.id, areaFolder(area));
      if (existsSync(folder)) continue;
      mkdirSync(folder, { recursive: true, mode: PRIVATE_DIR });
      for (const [file, text] of Object.entries(AREA_STARTER_FILES)) writePrivateFile(join(folder, file), text);
    }
  }

  deleteArea(companyId: string, areaId: string): void {
    const company = this.readCompany(companyId);
    const area = company.subdomains.find((item) => item.id === areaId);
    if (!area) throw new Error('This area is no longer part of this client.');
    if (company.defaultAreaId === areaId) throw new Error(`${area.name} is the default area of this client. Tasks without another area live there, so it cannot be deleted.`);
    rmSync(this.paths.areaDir(companyId, areaFolder(area)), { recursive: true, force: true });
    this.saveCompany({
      ...company,
      subdomains: company.subdomains.filter((area) => area.id !== areaId),
      projects: company.projects.map((repo) => (repo.subdomainId === areaId ? { ...repo, subdomainId: undefined } : repo)),
    });
    this.listTasks(companyId)
      .filter((task) => task.subdomainId === areaId)
      .forEach((task) => this.updateTask(task.id, { subdomainId: company.defaultAreaId }));
  }

  addClonedProject(companyId: string, baseDir: string, repoPath: string, target: string): void {
    const company = this.readCompany(companyId);
    if (company.projects.some((project) => project.path === target)) return;
    this.saveCompany({
      ...company,
      rootDir: company.rootDir ?? baseDir,
      projects: [...company.projects, { id: randomUUID(), name: repoPath, path: target }],
    });
  }

  saveCompany(company: Company): Company {
    const incoming = companySchema.parse(withCoreArea(companySchema.parse(company), randomUUID));
    const withHistory = existsSync(this.paths.companyFile(incoming.id)) ? withFolderHistory(this.readCompany(incoming.id), incoming, new Date().toISOString()) : incoming;
    const parsed = this.placeAreaFolders(withHistory);
    writePrivateFile(this.paths.companyFile(parsed.id), stringify(parsed));
    this.ensureAreaFolders(parsed);
    this.syncFolderPointers(parsed);
    return parsed;
  }

  private placeAreaFolders(company: Company): Company {
    const areasDir = this.paths.areasDir(company.id);
    const { areas, moves } = placeAreaFolders(company.subdomains, (folder) => existsSync(join(areasDir, folder)));
    for (const move of moves) renameSync(join(areasDir, move.from), join(areasDir, move.to));
    return { ...company, subdomains: areas };
  }

  saveCompanyPhoto(companyId: string, sourceUrl: string, photo: DownloadedPhoto): void {
    writePrivateFile(this.paths.photoFile(companyId), photo.bytes);
    this.saveCompany({
      ...this.readCompany(companyId),
      photo: { sourceUrl, type: photo.type, savedAt: new Date().toISOString() },
    });
  }

  removeCompanyPhoto(companyId: string): void {
    rmSync(this.paths.photoFile(companyId), { force: true });
    this.saveCompany({ ...this.readCompany(companyId), photo: undefined });
  }

  readCompanyPhoto(companyId: string): string | null {
    const { photo } = this.readCompany(companyId);
    const file = this.paths.photoFile(companyId);
    if (!photo || !existsSync(file)) return null;
    return `data:${photo.type};base64,${readFileSync(file).toString('base64')}`;
  }

  listTasks(companyId: string): Task[] {
    const tasks = listFiles(this.paths.tasksDir(companyId), '.json').map((name) =>
      taskSchema.parse(withProjectIds(JSON.parse(readFileSync(`${this.paths.tasksDir(companyId)}/${name}`, 'utf8')))),
    );
    const placed = tasks.some((task) => !task.subdomainId) ? this.placeTasksInDefaultArea(companyId, tasks) : tasks;
    return placed.some((task) => task.number === undefined) ? this.numberOldTasks(companyId, placed) : placed;
  }

  private placeTasksInDefaultArea(companyId: string, tasks: Task[]): Task[] {
    const subdomainId = this.defaultAreaId(companyId);
    return tasks.map((task) => {
      if (task.subdomainId) return task;
      const placed = { ...task, subdomainId };
      this.writeTask(placed);
      return placed;
    });
  }

  private validAreaId(companyId: string, areaId: string | undefined): string {
    if (!areaId) return this.defaultAreaId(companyId);
    if (!this.readCompany(companyId).subdomains.some((area) => area.id === areaId)) throw new Error('This area is no longer part of this client.');
    return areaId;
  }

  private numberOldTasks(companyId: string, tasks: Task[]): Task[] {
    let last = this.lastTaskNumber(companyId, tasks);
    const numbered = [...tasks]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map((task) => {
        if (task.number !== undefined) return task;
        last += 1;
        const withNumber = { ...task, number: last };
        this.writeTask(withNumber);
        return withNumber;
      });
    writePrivateFile(this.paths.taskCounterFile(companyId), String(last));
    return numbered;
  }

  private lastTaskNumber(companyId: string, tasks: Task[]): number {
    const file = this.paths.taskCounterFile(companyId);
    const stored = existsSync(file) ? Number(readFileSync(file, 'utf8')) : 0;
    return Math.max(Number.isInteger(stored) ? stored : 0, ...tasks.map((task) => task.number ?? 0));
  }

  private claimTaskNumber(companyId: string, write: (number: number) => void): number {
    const counter = this.paths.taskCounterFile(companyId);
    mkdirSync(dirname(counter), { recursive: true, mode: PRIVATE_DIR });
    return withFileLock(`${counter}.lock`, () => {
      const next = this.lastTaskNumber(companyId, this.listTasks(companyId)) + 1;
      writePrivateFile(counter, String(next));
      write(next);
      return next;
    });
  }

  findTask(taskId: string): Task {
    const task = this.listCompanies()
      .flatMap((company) => this.listTasks(company.id))
      .find((item) => item.id === taskId);
    if (!task) throw new Error(`Task ${taskId} no longer exists.`);
    return task;
  }

  createTask(input: NewTask, source?: TaskSource, status: TaskStatus = 'todo'): Task {
    const parsed = newTaskSchema.parse(input);
    const now = new Date().toISOString();
    const draft: Task = {
      ...parsed,
      subdomainId: this.validAreaId(parsed.companyId, parsed.subdomainId),
      id: randomUUID(),
      description: parsed.description ?? '',
      note: '',
      checklist: (parsed.checklist ?? []).map((text) => ({ id: randomUUID(), text, done: false })),
      priority: 'none',
      projectIds: parsed.projectIds ?? [],
      status,
      source,
      isolated: parsed.isolated ?? true,
      worktrees: [],
      createdAt: now,
      updatedAt: now,
    };
    const number = this.claimTaskNumber(parsed.companyId, (claimed) => this.writeTask({ ...draft, number: claimed }));
    return { ...draft, number };
  }

  saveTaskNote(taskId: string, note: string): void {
    this.writeTask({ ...this.findTask(taskId), note });
  }

  updateTask(taskId: string, patch: TaskPatch): Task {
    const current = this.findTask(taskId);
    const change = taskPatchSchema.parse(patch);
    const subdomainId = 'subdomainId' in patch ? this.validAreaId(current.companyId, change.subdomainId) : current.subdomainId;
    const changed = withDoneDate(current, { ...current, ...change, subdomainId, updatedAt: new Date().toISOString() });
    const updated = change.rank === undefined ? withBacklogPlace(current, changed, this.listTasks(current.companyId)) : changed;
    const task = current.status === 'done' && updated.status !== 'done' && current.agentStatus === 'done' ? this.withReportCleared(updated) : updated;
    this.writeTask(task);
    return task;
  }

  setTaskCode(taskId: string, worktrees: TaskWorktree[], projectIds?: string[]): Task {
    const current = this.findTask(taskId);
    const task = { ...current, worktrees, projectIds: projectIds ?? current.projectIds, updatedAt: new Date().toISOString() };
    this.writeTask(task);
    return task;
  }

  private withReportCleared(task: Task): Task {
    this.writeNotes(task, withNotesStatus(this.readNotes(task), IN_PROGRESS));
    return { ...task, agentStatus: IN_PROGRESS };
  }

  applyAgentStatus(taskId: string): void {
    const task = this.findTask(taskId);
    const { status } = parseTaskNotes(this.readNotes(task));
    if (status === task.agentStatus) return;
    this.writeTask({ ...task, agentStatus: status, updatedAt: new Date().toISOString() });
  }

  markFeedbackSent(taskId: string, key: string): Task {
    const task = { ...this.findTask(taskId), feedbackSent: key, updatedAt: new Date().toISOString() };
    this.writeTask(task);
    return task;
  }

  linkTaskSource(taskId: string, source: TaskSource | undefined): Task {
    const current = this.findTask(taskId);
    const other = source && this.listTasks(current.companyId).find((task) => task.id !== taskId && task.source?.kind === source.kind && task.source.key === source.key);
    if (other) throw new Error(`${source.key} is already linked to task #${other.number ?? other.title}.`);
    const task = { ...current, source, customTitle: source ? true : current.customTitle, updatedAt: new Date().toISOString() };
    this.writeTask(task);
    return task;
  }

  setBacklogPlan(taskId: string, backlogPlan: BacklogPlanLink): Task {
    const task = { ...this.findTask(taskId), backlogPlan, updatedAt: new Date().toISOString() };
    this.writeTask(task);
    return task;
  }

  deleteTask(taskId: string): void {
    const task = this.findTask(taskId);
    this.listSessions()
      .filter((item) => item.taskId === taskId)
      .forEach((session) => this.deleteSessionFiles(session));
    rmSync(this.paths.notesFile(task.companyId, taskId), { force: true });
    rmSync(this.paths.feedbackFile(task.companyId, taskId), { force: true });
    rmSync(this.paths.planFile(task.companyId, taskId), { force: true });
    this.listTaskOutputs(task).forEach((output) => rmSync(this.taskOutputFile(task, output.name), { force: true }));
    rmSync(this.paths.taskFile(task.companyId, taskId), { force: true });
  }

  deleteSessionsOfCompany(companyId: string): void {
    this.listSessions()
      .filter((session) => session.companyId === companyId)
      .forEach((session) => this.deleteSessionFiles(session));
  }

  private deleteSessionFiles(session: Session): void {
    for (const file of [
      this.paths.sessionFile(session.id),
      this.paths.statusFile(session.id),
      this.paths.stepFile(session.id),
      this.paths.promptFile(session.id),
      this.paths.settingsFile(session.id),
      this.paths.activityFile(session.id),
    ]) {
      rmSync(file, { force: true });
    }
    rmSync(this.paths.sessionDir(session.id), { recursive: true, force: true });
    rmSync(this.paths.planChecksDir(session.id), { recursive: true, force: true });
  }

  private writeTask(task: Task): void {
    writePrivateFile(this.paths.taskFile(task.companyId, task.id), JSON.stringify(taskSchema.parse(task), null, 2));
  }

  readNotes(task: Task): string {
    const file = this.paths.notesFile(task.companyId, task.id);
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
  }

  listTaskOutputs(task: Task): TaskOutput[] {
    const folder = this.paths.tasksDir(task.companyId);
    const own = [this.paths.notesFile(task.companyId, task.id), this.paths.feedbackFile(task.companyId, task.id)].map((file) => basename(file));
    const prefix = `${task.id}.`;
    return listFiles(folder, '.md')
      .filter((name) => name.startsWith(prefix) && !own.includes(name))
      .map((name) => ({ name, stats: lstatSync(join(folder, name)) }))
      .filter(({ stats }) => stats.isFile())
      .sort((first, second) => second.stats.mtimeMs - first.stats.mtimeMs)
      .map(({ name, stats }) => ({ name: name.slice(prefix.length), updatedAt: stats.mtime.toISOString() }));
  }

  taskOutputFile(task: Task, name: string): string {
    if (!this.listTaskOutputs(task).some((output) => output.name === name)) throw new Error(`${name} is not an output of this task.`);
    return join(this.paths.tasksDir(task.companyId), `${task.id}.${name}`);
  }

  writeNotes(task: Task, notes: string): void {
    writePrivateFile(this.paths.notesFile(task.companyId, task.id), notes);
  }

  listSessions(): Session[] {
    return listFiles(this.paths.sessionsDir, '.json').map((name) =>
      sessionSchema.parse(JSON.parse(readFileSync(`${this.paths.sessionsDir}/${name}`, 'utf8'))),
    );
  }

  firstSessionAt(taskId: string): string | null {
    const [first] = this.listSessions()
      .filter((session) => session.taskId === taskId)
      .map((session) => session.startedAt)
      .sort();
    return first ?? null;
  }

  saveSession(session: Session): void {
    writePrivateFile(this.paths.sessionFile(session.id), JSON.stringify(sessionSchema.parse(session), null, 2));
  }

  markAllSessionsStopped(): void {
    for (const session of this.listSessions()) {
      if (session.state !== 'stopped') this.saveSession({ ...session, state: 'stopped' });
    }
  }
}
