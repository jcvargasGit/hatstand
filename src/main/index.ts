import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, powerSaveBlocker, safeStorage, shell } from 'electron';
import type { HatstandApi, HatstandEvents } from '../shared/api';
import { gitOrigin, gitTokenName } from '../shared/git-source';
import { areaFolder } from '../shared/areas';
import { parseIssueReference } from '../shared/issue-reference';
import { migrateClientFolders } from './area-migration';
import { gitSourceSchema, ideaSchema, secretNameSchema, stayAwakeModeSchema, todayLayoutSchema, type Account, type Company, gitIdentityInputSchema } from '../shared/schemas';
import { AgentSignIn, checkAgent } from './agent-status';
import { createBacklogPlanTask, readPlanReport, savePlan, setPlanApproval } from './backlog-plan';
import { DescriptionSuggester } from './description-suggestion';
import { parseEnvFile } from './env';
import { listRemoteRepos } from './git-hosts';
import { allowedFile, createDocument, listClientFiles, readClientFile } from './client-files';
import { detectEditor, openClientWorkspace, openFileInEditor, openInEditor } from './editor';
import { repoChanges, taskFileDiff, taskRepoChanges } from './git-changes';
import { searchWorkspace } from './search';
import { shouldStayAwake, StayAwake } from './stay-awake';
import { removeClient } from './client-removal';
import { DEV_COPY_MESSAGE, isDevCopy } from './dev-copy';
import { canInstallRelease, readReleaseStatus, startRelease } from './release';
import { activeFolder, activePluginDir, countFolderFiles, looksLikePlugin } from './active-folders';
import { planningConflict, suggestPlanningPlaces, withPlanningRepo } from './planning';
import { createPlanningRepo, defaultPlanningFolder } from './planning-repo';
import { detectRepoLayout, listFolders } from './repo-layout';
import { buildFeedbackFile, feedbackPrompt } from './review-feedback';
import { ReviewMonitor } from './review-monitor';
import { applyGitIdentity, gitIdentityStatus, previewGitIdentity } from './git-identity';
import { activeWorktrees, defaultClientFolder, sessionFolder, workingDirFor } from './task-folders';
import { keptMessage, removeWorktrees } from './worktrees';
import { createPlaybook, customizePlaybook, findPlaybook, listPlaybooks, removePlaybook, startGuide } from './playbooks';
import { buildGuardScript } from './guard/hook-script';
import { guardStatus, installGuard, refreshFingerprints, removeControlRepoHooks } from './guard/service';
import { writePrivateFile } from './store';
import { assertOutsideGit, dataPaths, findGitRoot, prepareCloneDir, resolveHome, resolveUserPath } from './paths';
import { downloadPhoto } from './photos';
import { cloneRepos } from './repo-clone';
import { canEncryptSafely, SecretStore, type SecretCipher } from './secrets';
import { SessionManager } from './sessions';
import { probeShellTools, scanRepos } from './shell';
import { Store } from './store';
import { syncTrackers } from './trackers/sync';

const WINDOW_TITLE = app.isPackaged ? 'Hatstand' : 'Hatstand (development)';

// Electron's default menu on Linux takes Ctrl+Shift+I, which is the shortcut of the backlog here.
if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

// Playwright starts Electron with --password-store=basic, which leaves Linux without a keychain.
// Only the end-to-end tests set this, so their secrets use a key that is not secret.
const testKeychain = process.platform === 'linux' && !app.isPackaged && process.env.HATSTAND_TEST_KEYCHAIN === '1';

const electronCipher: SecretCipher = {
  encrypt(plain) {
    const safe = testKeychain || canEncryptSafely({
      platform: process.platform,
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
      linuxBackend: process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined,
    });
    if (!safe) {
      throw new Error('The system keychain is not available, so secrets cannot be stored safely. On Linux, install and unlock a secret store such as GNOME Keyring or KWallet.');
    }
    return safeStorage.encryptString(plain);
  },
  decrypt: (sealed) => safeStorage.decryptString(sealed),
};

if (process.env.HATSTAND_HOME) app.setPath('userData', join(resolveHome(), 'electron'));
if (testKeychain) safeStorage.setUsePlainTextEncryption(true);
if (app.isPackaged && !process.env.LANG && !process.env.LC_ALL) process.env.LANG = 'en_US.UTF-8';

let mainWindow: BrowserWindow | null = null;

const headless = process.env.HATSTAND_HEADLESS === '1';
if (headless && process.platform === 'darwin') app.setActivationPolicy('accessory');

function notify(title: string, body: string): void {
  if (!headless) new Notification({ title, body }).show();
}

function emit<E extends keyof HatstandEvents>(event: E, payload: HatstandEvents[E]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(event, payload);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 520,
    title: WINDOW_TITLE,
    show: !headless,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1f26' : '#f6f7f9',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !headless,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('page-title-updated', (event) => event.preventDefault());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

async function bootstrap(): Promise<void> {
  const home = resolveHome();
  assertOutsideGit(home);
  const paths = dataPaths(home);
  const store = new Store(paths);
  const secrets = new SecretStore(paths, electronCipher);
  const tools = await probeShellTools();
  store.markAllSessionsStopped();
  const unmigrated = new Set<string>();
  store.listCompanies().forEach((company) => {
    try {
      const report = migrateClientFolders(store, paths, company.id);
      if (report.backup) console.info(`Hatstand updated the folders of ${company.id}. Backup: ${report.backup}`);
    } catch (error) {
      unmigrated.add(company.id);
      console.error(`Hatstand could not update the folders of ${company.id}:`, error);
    }
  });
  store.listCompanies().forEach((company) => {
    store.ensureClientFolders(company.id);
    if (!unmigrated.has(company.id)) store.ensureAreaFolders(company);
    store.syncFolderPointers(company);
  });
  const clearControlRepoHooks = (company: Company) => removeControlRepoHooks(company, store.listCompanies().filter((other) => other.id !== company.id));
  store.listCompanies().forEach(clearControlRepoHooks);
  const savePlanningRepo = (company: Company, path: string) => {
    const saved = store.saveCompany(withPlanningRepo(company, path, suggestPlanningPlaces(listFolders(path))));
    clearControlRepoHooks(saved);
    refreshFingerprints(paths, saved, secrets.read(company.id));
    emit('state-changed', null);
  };
  if (existsSync(paths.guardScript)) writePrivateFile(paths.guardScript, buildGuardScript());

  const stayAwake = new StayAwake(powerSaveBlocker);
  const applyStayAwake = () => stayAwake.apply(shouldStayAwake(store.readPreferences().stayAwake, sessions.liveCount()));

  const sessions = new SessionManager(paths, store, secrets, tools.path, {
    onData: (sessionId, data, end) => emit('session-data', { sessionId, data, end }),
    onChange: () => {
      applyStayAwake();
      emit('state-changed', null);
    },
    onNeedsInput: (session) => {
      const task = store.findTask(session.taskId);
      notify('A session is waiting for you', task.title);
    },
  });

  applyStayAwake();

  const reviews = new ReviewMonitor({
    store,
    secrets,
    path: tools.path,
    onChange: () => emit('state-changed', null),
    onNews: (task, message) => notify(message, task.title),
  });
  reviews.start();

  const openFile = async (file: string) => {
    const name = openFileInEditor(file, tools.path);
    if (name) return name;
    const failure = await shell.openPath(file);
    if (failure) throw new Error(failure);
    return 'your default app';
  };

  const removeCopies = async (taskId: string, onlyIfClean: boolean) => {
    const task = store.findTask(taskId);
    const report = await removeWorktrees(store.readCompany(task.companyId), task, tools.path);
    store.setTaskCode(taskId, task.worktrees.filter((worktree) => !report.removed.includes(worktree.path)));
    if (onlyIfClean && report.kept.length > 0) throw new Error(keptMessage(report));
    return report;
  };

  const signIn = new AgentSignIn(tools.path, {
    onData: (sessionId, data, end) => emit('session-data', { sessionId, data, end }),
    onExit: () => emit('state-changed', null),
  });
  const suggester = new DescriptionSuggester(paths, store, tools.path);
  const downloading = new Set<string>();
  const requireAccount = (accountId: string): Account => {
    const account = store.readAccounts().accounts.find((item) => item.id === accountId);
    if (!account) throw new Error('This agent account no longer exists.');
    return account;
  };

  const pick = async (title: string, property: 'openDirectory' | 'openFile'): Promise<string | null> => {
    const options = {
      title,
      properties: [property, 'showHiddenFiles'] as ('openDirectory' | 'openFile' | 'showHiddenFiles')[],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  };

  const canRelease = () => canInstallRelease({ platform: process.platform, isDevCopy: isDevCopy(), isPackaged: app.isPackaged });
  const releaseFolders = () => ({ home, appRoot: app.getAppPath(), path: tools.path });

  const api: HatstandApi = {
    getSnapshot: async () => ({ ...store.snapshot(), reviews: reviews.all() }),
    createCompany: async (name, color, origin) => store.createCompany(name, color, origin),
    connectGitSource: async (companyId, rawSource, rawToken) => {
      const source = gitSourceSchema.parse(rawSource);
      const tokenName = gitTokenName(source.provider);
      const token = rawToken?.trim() || secrets.read(companyId)[tokenName];
      if (!token) throw new Error('Paste a token so Hatstand can see this client\'s repositories.');
      const repos = await listRemoteRepos(source, token);
      secrets.merge(companyId, {
        [tokenName]: token,
        ...(source.provider === 'gitlab' ? { GITLAB_URL: gitOrigin(source) } : {}),
      });
      store.saveCompany({ ...store.readCompany(companyId), gitSource: source });
      emit('state-changed', null);
      return repos;
    },
    downloadRepos: async (companyId, rawDir, repoPaths) => {
      if (downloading.has(companyId)) throw new Error('This client is already downloading repositories.');
      const source = store.readCompany(companyId).gitSource;
      if (!source) throw new Error('Connect GitHub or GitLab first.');
      const token = secrets.read(companyId)[gitTokenName(source.provider)];
      if (!token) throw new Error('Paste a token so Hatstand can download this client\'s repositories.');
      const baseDir = prepareCloneDir(rawDir, home);
      downloading.add(companyId);
      try {
        const available = await listRemoteRepos(source, token);
        return await cloneRepos({
          repos: available.filter((repo) => repoPaths.includes(repo.path)),
          baseDir,
          provider: source.provider,
          token,
          path: tools.path,
          onProgress: (progress, target) => {
            if (progress.state === 'cloned' || progress.state === 'existing') {
              store.addClonedProject(companyId, baseDir, progress.path, target);
              emit('state-changed', null);
            }
            emit('clone-progress', { ...progress, companyId });
          },
        });
      } finally {
        downloading.delete(companyId);
      }
    },
    checkAgent: (accountId) => checkAgent(requireAccount(accountId), tools.path),
    startAgentSignIn: async (accountId) => signIn.start(requireAccount(accountId)),
    saveCompany: async (company) => store.saveCompany(company),
    setClientPhoto: async (companyId, link) => store.saveCompanyPhoto(companyId, link, await downloadPhoto(link)),
    removeClientPhoto: async (companyId) => store.removeCompanyPhoto(companyId),
    readClientPhoto: async (companyId) => store.readCompanyPhoto(companyId),
    saveAccount: async (account) =>
      store.saveAccount(account.id ? account : { ...account, id: randomUUID() }),
    removeAccount: async (accountId) => store.removeAccount(accountId),
    setDefaultAccount: async (accountId) => store.setDefaultAccount(accountId),
    resetClientFolder: async (companyId) => {
      const company = store.readCompany(companyId);
      const target = defaultClientFolder(company);
      store.saveCompany({ ...company, rootDir: existsSync(target) ? target : prepareCloneDir(target, paths.home) });
      emit('state-changed', null);
    },
    inspectRepoLayout: async (companyId, projectId) => {
      const project = store.readCompany(companyId).projects.find((item) => item.id === projectId);
      if (!project) throw new Error('This repository is no longer part of this client.');
      return detectRepoLayout(project.path);
    },
    setPlanningRepo: async (companyId, rawPath) => {
      const company = store.readCompany(companyId);
      const conflict = planningConflict(company, rawPath, paths.home, store.listTasks(companyId));
      if (conflict) throw new Error(conflict);
      savePlanningRepo(company, resolve(rawPath));
    },
    createPlanningRepo: async (companyId, rawPath) => {
      if (isDevCopy()) throw new Error(DEV_COPY_MESSAGE);
      const company = store.readCompany(companyId);
      if (company.planning) throw new Error('This client already has a planning repository.');
      savePlanningRepo(company, await createPlanningRepo(company, rawPath, paths.home, tools.path));
    },
    defaultPlanningFolder: async (companyId) => defaultPlanningFolder(store.readCompany(companyId)),
    listPlanningFolders: async (companyId) => {
      const path = store.readCompany(companyId).planning?.path;
      return path && existsSync(path) ? listFolders(path) : [];
    },
    archiveClient: async (companyId) => {
      if (sessions.hasLiveClientSession(companyId)) throw new Error('Stop this client\'s sessions before archiving it.');
      store.saveCompany({ ...store.readCompany(companyId), archivedAt: new Date().toISOString() });
      emit('state-changed', null);
    },
    restoreClient: async (companyId) => {
      store.saveCompany({ ...store.readCompany(companyId), archivedAt: undefined });
      emit('state-changed', null);
    },
    removeClient: async (companyId, deleteFiles) => {
      if (sessions.hasLiveClientSession(companyId)) throw new Error('Stop this client\'s sessions before removing it.');
      for (const task of store.listTasks(companyId)) await removeCopies(task.id, true);
      const report = removeClient(store, paths, companyId, deleteFiles);
      emit('state-changed', null);
      return report;
    },
    createTask: async ({ playbookId, ...input }) => {
      const task = store.createTask(input);
      return playbookId ? store.updateTask(task.id, { guide: startGuide(findPlaybook(paths, input.companyId, playbookId)) }) : task;
    },
    updateTask: async (taskId, patch) => store.updateTask(taskId, patch),
    linkTaskIssue: async (taskId, reference) => {
      const task = store.linkTaskSource(taskId, parseIssueReference(reference));
      emit('state-changed', null);
      return task;
    },
    unlinkTaskIssue: async (taskId) => {
      const task = store.linkTaskSource(taskId, undefined);
      emit('state-changed', null);
      return task;
    },
    openTaskWorktree: async (taskId, projectId) => {
      const worktree = store.findTask(taskId).worktrees.find((item) => item.projectId === projectId);
      if (!worktree) throw new Error('This task has no copy of that repository.');
      if (!existsSync(worktree.path)) throw new Error(`The folder ${worktree.path} is gone.`);
      const failure = await shell.openPath(worktree.path);
      if (failure) throw new Error(failure);
    },
    deleteTask: async (taskId) => {
      if (sessions.hasLiveSession(taskId)) throw new Error('Stop the session before deleting this task.');
      await removeCopies(taskId, true);
      store.deleteTask(taskId);
      emit('state-changed', null);
    },
    readNotes: async (taskId) => store.readNotes(store.findTask(taskId)),
    readTaskNote: async (taskId) => store.findTask(taskId).note,
    saveTaskNote: async (taskId, note) => store.saveTaskNote(taskId, note),
    refreshTaskSummary: async (taskId) => sessions.refreshSummary(taskId),
    listSecretNames: async (companyId) => secrets.names(companyId),
    setSecret: async (companyId, name, value) => {
      secrets.merge(companyId, { [secretNameSchema.parse(name)]: value });
      emit('state-changed', null);
    },
    deleteSecret: async (companyId, name) => {
      secrets.remove(companyId, name);
      emit('state-changed', null);
    },
    importEnvFile: async (companyId) => {
      const file = await pick('Choose an env file to import', 'openFile');
      if (!file) return 0;
      const values = parseEnvFile(readFileSync(file, 'utf8'));
      secrets.merge(companyId, values);
      emit('state-changed', null);
      return Object.keys(values).length;
    },
    openClientFolder: async (companyId, folder) => {
      store.ensureClientFolders(companyId);
      const company = store.readCompany(companyId);
      const target = folder === 'instructions' ? (company.context.instructionsFile ?? activePluginDir(paths, company)) : activeFolder(paths, company, folder);
      const failure = await shell.openPath(target);
      if (failure) throw new Error(failure);
    },
    folderSwitchImpact: async (companyId, section) => {
      const from = activeFolder(paths, store.readCompany(companyId), section);
      const openTasks = store.listTasks(companyId).filter((task) => (task.status === 'todo' || task.status === 'doing') && !task.archivedAt).length;
      return { from, files: countFolderFiles(from), openTasks };
    },
    listPastFolders: async (companyId, section) =>
      (store.readCompany(companyId).pastFolders ?? [])
        .filter((folder) => folder.section === section)
        .map(({ path, leftAt }) => ({ path, leftAt, exists: existsSync(path) })),
    isPluginFolder: async (path) => looksLikePlugin(path),
    pickDirectory: (title) => pick(title, 'openDirectory'),
    pickFile: (title) => pick(title, 'openFile'),
    resolvePath: async (path, kind) => resolveUserPath(path, kind),
    scanRepos: async (dir) => scanRepos(dir),
    isInsideGitRepo: async (path) => findGitRoot(path) !== null,
    startSession: async (taskId) => sessions.start(taskId),
    resumeSession: async (sessionId) => sessions.resume(sessionId),
    stopSession: async (sessionId) => sessions.stop(sessionId),
    writeSession: async (sessionId, data) =>
      signIn.has(sessionId) ? signIn.write(sessionId, data) : sessions.write(sessionId, data),
    sendDraft: async (sessionId) => sessions.sendDraft(sessionId),
    resizeSession: async (sessionId, cols, rows) =>
      signIn.has(sessionId) ? signIn.resize(sessionId, cols, rows) : sessions.resize(sessionId, cols, rows),
    readSessionBuffer: async (sessionId) =>
      signIn.has(sessionId) ? signIn.readBuffer(sessionId) : sessions.readBuffer(sessionId),
    readSessionOutput: async (sessionId) => (signIn.has(sessionId) ? signIn.readOutput(sessionId) : sessions.readOutput(sessionId)),
    listClientFiles: async (companyId) => listClientFiles(paths, store.readCompany(companyId)),
    readClientFile: async (companyId, path) => readClientFile(paths, store.readCompany(companyId), path),
    listPlaybooks: async (companyId) => listPlaybooks(paths, companyId),
    customizePlaybook: async (companyId, playbookId) => customizePlaybook(paths, companyId, playbookId),
    createPlaybook: async (companyId, name) => createPlaybook(paths, companyId, name),
    removePlaybook: async (companyId, playbookId) => removePlaybook(paths, companyId, playbookId),
    setTaskGuide: async (taskId, playbookId) => {
      if (playbookId === null) {
        store.updateTask(taskId, { guide: undefined, type: undefined });
        return;
      }
      sessions.changeGuide(taskId, startGuide(findPlaybook(paths, store.findTask(taskId).companyId, playbookId)));
      store.updateTask(taskId, { type: undefined });
    },
    moveGuideStep: async (taskId, index) => sessions.moveGuideStep(taskId, index),
    readSubagents: async (sessionId) => sessions.readSubagents(sessionId),
    guardStatus: async (companyId) => {
      const company = store.readCompany(companyId);
      const status = guardStatus(company);
      const protectedPaths = status.filter((repo) => repo.state === 'protected').map((repo) => repo.path);
      if ([...protectedPaths].sort().join('\n') !== [...company.protectedPaths].sort().join('\n')) {
        store.saveCompany({ ...company, protectedPaths });
        emit('state-changed', null);
      }
      return status;
    },
    installGuard: async (companyId, keepExistingHooks = []) => {
      const company = store.readCompany(companyId);
      clearControlRepoHooks(company);
      const report = installGuard(paths, company, secrets.read(companyId), tools.nodePath, keepExistingHooks);
      store.saveCompany({ ...company, protectedPaths: report.installed });
      emit('state-changed', null);
      return report;
    },
    syncTrackers: async (companyId) => syncTrackers(store, companyId, secrets.read(companyId)),
    getReleaseStatus: async () => (canRelease() ? readReleaseStatus(releaseFolders()) : null),
    startRelease: async () => {
      if (canRelease()) startRelease(releaseFolders(), tools.nodePath);
    },
    getStayAwake: async () => ({ mode: store.readPreferences().stayAwake, active: stayAwake.active }),
    setStayAwake: async (mode) => {
      store.savePreferences({ stayAwake: stayAwakeModeSchema.parse(mode) });
      applyStayAwake();
      emit('state-changed', null);
    },
    setClientOrder: async (companyIds) => {
      store.savePreferences({ clientOrder: companyIds });
      emit('state-changed', null);
    },
    setTodayLayout: async (layout) => {
      store.savePreferences({ todayLayout: todayLayoutSchema.parse(layout) });
      emit('state-changed', null);
    },
    setGuideNewTasks: async (enabled) => {
      store.savePreferences({ guideNewTasks: enabled === true });
      emit('state-changed', null);
    },
    searchEverything: async (query) => {
      const companies = store.listCompanies();
      return searchWorkspace(query, {
        companies,
        tasks: companies.flatMap((company) => store.listTasks(company.id)),
        readNotes: (task) => store.readNotes(task),
        listFiles: (company) => listClientFiles(paths, company),
      });
    },
    createDocument: async (companyId, where, name) => {
      const company = store.readCompany(companyId);
      const file = createDocument(paths, company, where, name);
      refreshFingerprints(paths, company, secrets.read(companyId));
      emit('state-changed', null);
      return file;
    },
    planningStatus: async (companyId) => {
      const planning = store.readCompany(companyId).planning;
      if (!planning || !findGitRoot(planning.path)) return null;
      return { projectId: 'planning', name: 'Planning repository', path: planning.path, committed: [], before: [], commits: 0, ...(await repoChanges(planning.path, tools.path)) };
    },
    taskChanges: async (taskId) => {
      const task = store.findTask(taskId);
      return taskRepoChanges(store.readCompany(task.companyId), task, tools.path, store.firstSessionAt(taskId));
    },
    taskFileDiff: async (taskId, projectId, file) => {
      const task = store.findTask(taskId);
      return taskFileDiff(store.readCompany(task.companyId), task, projectId, file, tools.path);
    },
    openInEditor: async (companyId, path) => {
      const company = store.readCompany(companyId);
      const copies = store.listTasks(companyId).flatMap((task) => task.worktrees.map((worktree) => worktree.path));
      const known = [...company.projects.map((project) => project.path), company.planning?.path, company.rootDir, ...copies];
      if (!known.includes(path)) throw new Error('This folder is not part of this client.');
      await openInEditor(path, tools.path, (folder) => shell.openPath(folder));
    },
    detectEditor: async () => detectEditor(tools.path)?.name ?? null,
    openClientInEditor: async (companyId) => {
      store.ensureClientFolders(companyId);
      return openClientWorkspace(paths, store.readCompany(companyId), tools.path);
    },
    openTaskInEditor: async (taskId) => {
      const task = store.findTask(taskId);
      const company = store.readCompany(task.companyId);
      const folder = sessionFolder(activeWorktrees(company, task)) ?? workingDirFor(paths, company, task);
      return openInEditor(folder, tools.path, (target) => shell.openPath(target));
    },
    openClientFileInEditor: async (companyId, path) => openFile(allowedFile(paths, store.readCompany(companyId), path)),
    openTaskNotesInEditor: async (taskId) => {
      const task = store.findTask(taskId);
      const file = paths.notesFile(task.companyId, task.id);
      if (!existsSync(file)) store.writeNotes(task, '');
      return openFile(file);
    },
    listTaskOutputs: async (taskId) => store.listTaskOutputs(store.findTask(taskId)),
    readTaskOutput: async (taskId, name) => readFileSync(store.taskOutputFile(store.findTask(taskId), name), 'utf8'),
    openTaskOutputInEditor: async (taskId, name) => openFile(store.taskOutputFile(store.findTask(taskId), name)),
    removeTaskCopies: async (taskId) => {
      if (sessions.hasLiveSession(taskId)) throw new Error('Stop the session before removing the copy of the code.');
      await removeCopies(taskId, true);
      emit('state-changed', null);
    },
    refreshReviews: async (taskId) => {
      await (taskId ? reviews.check(taskId) : reviews.checkAll());
      emit('state-changed', null);
    },
    giveFeedbackToAgent: async (taskId) => {
      await reviews.check(taskId);
      const review = reviews.get(taskId);
      if (!review?.feedbackKey) throw new Error('There are no CI failures or open comments to give the agent.');
      const task = store.findTask(taskId);
      const logs = await reviews.failureLogs(task);
      const file = paths.feedbackFile(task.companyId, taskId);
      writePrivateFile(file, buildFeedbackFile(task, review.pulls, logs, secrets.read(task.companyId)));
      await sessions.sendPrompt(taskId, feedbackPrompt(file));
      store.markFeedbackSent(taskId, review.feedbackKey);
      emit('state-changed', null);
    },
    addIdeas: async (companyId, ideas) => {
      const ranks = store.listTasks(companyId).flatMap((task) => (task.rank !== undefined ? [task.rank] : []));
      const firstRank = Math.max(-1, ...ranks) + 1;
      ideas
        .map((item) => ideaSchema.parse(item))
        .forEach((idea, index) => store.createTask({ companyId, title: idea.title, description: idea.description, checklist: idea.checklist, rank: firstRank + index }, undefined, 'idea'));
      emit('state-changed', null);
    },
    reorderTasks: async (taskIds) => {
      taskIds.forEach((taskId, rank) => store.updateTask(taskId, { rank }));
      emit('state-changed', null);
    },
    openLink: async (url) => {
      const { protocol } = new URL(url);
      if (protocol !== 'https:' && protocol !== 'http:') throw new Error('Only web links can be opened.');
      await shell.openExternal(url);
    },
    createArea: async (companyId, name) => {
      const area = store.createArea(companyId, name);
      emit('state-changed', null);
      return area;
    },
    deleteArea: async (companyId, areaId) => {
      store.deleteArea(companyId, areaId);
      emit('state-changed', null);
    },
    openAreaInEditor: async (companyId, areaId) => {
      const area = store.readCompany(companyId).subdomains.find((item) => item.id === areaId);
      if (!area) throw new Error('This area is no longer part of this client.');
      await openInEditor(paths.areaDir(companyId, areaFolder(area)), tools.path, (folder) => shell.openPath(folder));
    },
    gitIdentityStatus: async (companyId) => gitIdentityStatus(store.readCompany(companyId), tools.path),
    previewGitIdentity: async (companyId, identity) => previewGitIdentity(store.readCompany(companyId), gitIdentityInputSchema.parse(identity), tools.path),
    applyGitIdentity: async (companyId, identity) => {
      if (isDevCopy()) throw new Error(DEV_COPY_MESSAGE);
      const input = gitIdentityInputSchema.parse(identity);
      const company = await applyGitIdentity(store.readCompany(companyId), input, tools.path, paths.backupsDir);
      store.saveCompany(company);
      emit('state-changed', null);
      return gitIdentityStatus(company, tools.path);
    },
    suggestDescription: async (request) => suggester.suggest(request),
    cancelDescriptionSuggestion: async (key) => suggester.cancel(key),
    planBacklog: async (companyId, taskIds) => {
      const task = createBacklogPlanTask(store, companyId, taskIds);
      emit('state-changed', null);
      return task;
    },
    readBacklogPlan: async (taskId) => readPlanReport(store, paths, store.findTask(taskId)),
    saveBacklogPlan: async (taskId, plan) => {
      const report = savePlan(store, paths, taskId, plan);
      emit('state-changed', null);
      return report;
    },
    setBacklogPlanApproval: async (taskId, approved) => {
      const report = setPlanApproval(store, paths, taskId, approved);
      emit('state-changed', null);
      return report;
    },
  };

  ipcMain.handle('hatstand', (_event, method: string, args: unknown[]) => {
    if (!Object.hasOwn(api, method)) throw new Error(`Unknown method ${method}.`);
    const handler = api[method as keyof HatstandApi] as (...input: unknown[]) => Promise<unknown>;
    return handler(...args);
  });

  let confirmedQuit = false;
  app.on('before-quit', (event) => {
    reviews.stop();
    signIn.stopAll();
    suggester.stopAll();
    if (confirmedQuit || sessions.liveCount() === 0 || headless || process.env.HATSTAND_SKIP_QUIT_PROMPT) {
      sessions.stopAll();
      return;
    }
    const choice = dialog.showMessageBoxSync({
      type: 'question',
      buttons: ['Quit and stop sessions', 'Keep working'],
      defaultId: 1,
      cancelId: 1,
      message: `Stop ${sessions.liveCount()} running session(s)?`,
      detail: 'Each session can be resumed from its task the next time you open Hatstand.',
    });
    if (choice === 1) {
      event.preventDefault();
      return;
    }
    confirmedQuit = true;
    sessions.stopAll();
  });

  createWindow();
  app.on('browser-window-focus', () => {
    for (const company of store.listCompanies()) {
      try {
        refreshFingerprints(paths, company, secrets.read(company.id));
      } catch (error) {
        console.error(`Commit protection could not be updated for ${company.id}.`, error);
      }
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app
  .whenReady()
  .then(bootstrap)
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (headless) console.error(`Hatstand could not start: ${message}`);
    else dialog.showErrorBox('Hatstand could not start', message);
    app.exit(1);
  });
