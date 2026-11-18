import { homedir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, powerSaveBlocker, safeStorage, shell } from 'electron';
import type { HatstandApi, HatstandEvents } from '../shared/api';
import { AgentSignIn, checkAgent } from './agent-status';
import { DescriptionSuggester } from './description-suggestion';
import { openFileInEditor, openInEditor } from './editor';
import type { EditorTarget } from './editor-target';
import { assertOutsideGit, dataPaths, resolveHome } from './paths';
import { ReviewMonitor } from './review-monitor';
import { canEncryptSafely, SecretStore, type SecretCipher } from './secrets';
import { combineHandlers, createServices, type DesktopMethod, type ServiceContext } from './services';
import { createDesktopTargets, webLink } from './services/desktop-targets';
import { createRepoProtection } from './services/guard';
import type { NewTaskWindows } from './services/new-task-drafts';
import { importEnvFile } from './services/secrets';
import { prepareWorkspace } from './services/startup';
import { SessionManager } from './sessions';
import { probeShellTools } from './shell';
import { shouldStayAwake, StayAwake } from './stay-awake';
import { Store } from './store';
import { newTaskWindowQuery, windowOptions, type WindowKind } from './windows';

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
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(event, payload);
  }
}

function createWindow(kind: WindowKind, title: string, query?: Record<string, string>): BrowserWindow {
  const window = new BrowserWindow(
    windowOptions({ kind, title, preload: join(__dirname, '../preload/index.js'), headless, dark: nativeTheme.shouldUseDarkColors }),
  );
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.on('page-title-updated', (event) => event.preventDefault());
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
    void window.loadURL(url.toString());
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), query ? { query } : undefined);
  }
  return window;
}

function createMainWindow(): void {
  mainWindow = createWindow('main', WINDOW_TITLE);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** The windows a task is written in, by the draft each one shows. The drafts themselves live in a service. */
const newTaskWindows = new Map<string, BrowserWindow>();

const windows: NewTaskWindows = {
  open(draftId, onClosed) {
    const window = createWindow('new-task', 'New task', newTaskWindowQuery(draftId));
    newTaskWindows.set(draftId, window);
    window.on('closed', () => {
      onClosed();
      newTaskWindows.delete(draftId);
    });
  },
  close: (draftId) => newTaskWindows.get(draftId)?.close(),
};

async function pick(title: string, property: 'openDirectory' | 'openFile'): Promise<string | null> {
  const options = {
    title,
    properties: [property, 'showHiddenFiles'] as ('openDirectory' | 'openFile' | 'showHiddenFiles')[],
  };
  const parent = BrowserWindow.getFocusedWindow() ?? mainWindow;
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

async function openPath(target: string): Promise<void> {
  const failure = await shell.openPath(target);
  if (failure) throw new Error(failure);
}

async function bootstrap(): Promise<void> {
  const home = resolveHome();
  assertOutsideGit(home);
  const paths = dataPaths(home);
  const store = new Store(paths);
  const secrets = new SecretStore(paths, electronCipher);
  const tools = await probeShellTools();
  const ctx: ServiceContext = { store, paths, secrets, tools, emit, userHome: homedir(), fetch };
  const protection = createRepoProtection(ctx);
  prepareWorkspace(ctx, { protection });

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
  }, protection);

  applyStayAwake();

  const reviews = new ReviewMonitor({
    store,
    secrets,
    path: tools.path,
    onChange: () => emit('state-changed', null),
    onNews: (task, message) => notify(message, task.title),
  });
  reviews.start();

  const signIn = new AgentSignIn(tools.path, {
    onData: (sessionId, data, end) => emit('session-data', { sessionId, data, end }),
    onExit: () => emit('state-changed', null),
  });
  const suggester = new DescriptionSuggester(paths, store, tools.path);
  const installedApp = { platform: process.platform, isPackaged: app.isPackaged, appRoot: app.getAppPath() };

  const services = createServices(ctx, { protection, sessions, signIn, checkAgent, reviews, suggester, stayAwake, applyStayAwake, windows, installedApp });
  const targets = createDesktopTargets(ctx);

  // The editor of the person when they have one, and the desktop's own app or file browser when they do not.
  const openFile = async (file: string) => {
    const editor = openFileInEditor(file, tools.path);
    if (editor) return editor;
    await openPath(file);
    return 'your default app';
  };
  const openFolder = (folder: string) => openInEditor(folder, tools.path, (target) => shell.openPath(target));
  const openTarget = (target: EditorTarget) => (target.kind === 'file' ? openFile(target.path) : openFolder(target.path));

  // Each of these shows a dialog or opens something on the desktop. A service chooses what; Electron opens it.
  const desktop: Pick<HatstandApi, DesktopMethod> = {
    pickDirectory: (title) => pick(title, 'openDirectory'),
    pickFile: (title) => pick(title, 'openFile'),
    importEnvFile: async (companyId) => importEnvFile(ctx, companyId, await pick('Choose an env file to import', 'openFile')),
    openClientFolder: async (companyId, folder) => openPath(targets.clientFolder(companyId, folder)),
    openTaskWorktree: async (taskId, projectId) => openPath(targets.taskCopy(taskId, projectId)),
    openLink: async (url) => shell.openExternal(webLink(url)),
    openInEditor: async (companyId, path) => {
      await openTarget(targets.inEditor(companyId, path));
    },
    openTaskInEditor: async (taskId) => openFolder(targets.taskFolder(taskId)),
    openClientFileInEditor: async (companyId, path) => openFile(targets.clientFile(companyId, path)),
    openTaskNotesInEditor: async (taskId) => openFile(targets.taskNotes(taskId)),
    openTaskOutputInEditor: async (taskId, name) => openFile(targets.taskOutput(taskId, name)),
    openAreaInEditor: async (companyId, areaId) => {
      await openFolder(targets.areaFolder(companyId, areaId));
    },
  };

  const api: HatstandApi = combineHandlers(services, desktop);

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

  createMainWindow();
  app.on('browser-window-focus', () => protection.refreshAllFingerprints());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
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
