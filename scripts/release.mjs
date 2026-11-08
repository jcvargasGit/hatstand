// Publishes main to the installed app. Run "pnpm release", or use the button in "pnpm dev".
// An open app is never replaced: the update waits until you close it, so no session stops.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const POLL_MS = 2000;
const home = resolve(process.env.HATSTAND_HOME ?? join(homedir(), '.hatstand-dev'));
const stateFile = join(home, 'release.json');
const installedApp = join(process.env.HATSTAND_INSTALL_DIR ?? '/Applications', 'Hatstand.app');

const record = (state, version, message) => {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(stateFile, JSON.stringify({ state, version, message, pid: process.pid }));
};

const fail = (message, version = '') => {
  record('failed', version, message);
  console.error(message);
  process.exit(1);
};

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const processMatches = (pattern) => spawnSync('pgrep', ['-f', pattern], { stdio: 'ignore' }).status === 0;
const appIsOpen = () => processMatches(`${installedApp}/Contents/MacOS/`);

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const readPrevious = () => {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    return null;
  }
};

const findMainFolder = () => {
  const checkouts = git(process.cwd(), 'worktree', 'list', '--porcelain').split('\n\n').map((block) => block.split('\n'));
  return checkouts.find((lines) => lines.includes('branch refs/heads/main'))?.[0]?.replace('worktree ', '');
};

const stopPreviousRelease = () => {
  const previous = existsSync(stateFile) ? readPrevious() : null;
  if (!previous || !isAlive(previous.pid)) return;
  if (previous.state === 'building') {
    console.error('A new version is already being built.');
    process.exit(1);
  }
  if (previous.state === 'waiting') process.kill(previous.pid);
};

const step = (folder, command, args, version) => {
  const { status } = spawnSync(command, args, { cwd: folder, stdio: 'inherit' });
  if (status !== 0) fail(`The build failed at "${command} ${args.join(' ')}". Fix it, then try again.`, version);
};

const applyWhenClosed = async (folder, version) => {
  while (true) {
    if (appIsOpen()) {
      record('waiting', version);
      console.log(`Version ${version} is ready. It installs when you close Hatstand. Your sessions keep running until then.`);
      while (appIsOpen()) await new Promise((done) => setTimeout(done, POLL_MS));
    }
    const output = execFileSync('node', ['scripts/install-app.mjs', '--apply'], { cwd: folder, encoding: 'utf8' });
    if (output.includes('Installed')) return;
  }
};

stopPreviousRelease();
try {
  const folder = findMainFolder();
  if (!folder) fail('No folder has main checked out, so there is nothing to build from.');
  const version = git(folder, 'rev-parse', '--short=7', 'main');
  if (git(folder, 'status', '--porcelain', '--untracked-files=no')) fail(`${folder} has changes that are not committed. Commit or discard them, then try again.`, version);
  if (processMatches(`${folder}/node_modules.*Electron`)) fail(`Hatstand is running from ${folder}. Close it first, because this update reinstalls the packages of that folder.`, version);

  record('building', version);
  console.log(`Building version ${version} from ${folder}.`);
  step(folder, 'pnpm', ['install', '--frozen-lockfile'], version);
  step(folder, 'node', ['scripts/install-app.mjs', '--build-only'], version);
  await applyWhenClosed(folder, version);
  record('installed', version);
  console.log(`Version ${version} is installed. Open Hatstand to use it.`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
