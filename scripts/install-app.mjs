// Builds Hatstand as a Mac app and installs it. Run "pnpm install:app".
// A running app is never replaced, because it would stop the sessions inside it.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const APP_NAME = 'Hatstand.app';
const root = resolve(import.meta.dirname, '..');
const target = process.env.HATSTAND_INSTALL_DIR ?? '/Applications';
const installed = join(target, APP_NAME);
const applyOnly = process.argv.includes('--apply');
const buildOnly = process.argv.includes('--build-only');

const run = (command, args) => {
  const { status } = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (status !== 0) process.exit(status ?? 1);
};

const builtApp = () => {
  const dist = join(root, 'dist');
  const folder = existsSync(dist) ? readdirSync(dist).find((name) => name.startsWith('mac') && existsSync(join(dist, name, APP_NAME))) : undefined;
  return folder ? join(dist, folder, APP_NAME) : null;
};

const isRunning = () => spawnSync('pgrep', ['-f', `${installed}/Contents/MacOS/`], { stdio: 'ignore' }).status === 0;

if (process.platform !== 'darwin') {
  console.error('This installer is for macOS. On Linux, see docs/getting-started.md.');
  process.exit(1);
}

const git = (...args) => execFileSync('git', [...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const isExactlyMain = () => {
  try {
    return git('rev-parse', 'HEAD') === git('rev-parse', 'main') && git('status', '--porcelain', '--untracked-files=no') === '';
  } catch {
    return true;
  }
};

if (!applyOnly) {
  if (!isExactlyMain()) console.warn('Warning: this folder is not exactly main, so the app you work in will get unfinished code.\n');
  run('pnpm', ['exec', 'electron-vite', 'build']);
  run('pnpm', ['exec', 'electron-builder', '--mac', 'dir', '--publish', 'never', `-c.buildVersion=${git('rev-parse', '--short=7', 'HEAD')}`]);
  if (buildOnly) process.exit(0);
}

const built = builtApp();
if (!built) {
  console.error('There is no built app yet. Run "pnpm install:app".');
  process.exit(1);
}

if (isRunning()) {
  console.log('\nThe new version is built, and Hatstand is still running, so nothing was replaced.');
  console.log('When your sessions can stop, quit Hatstand and run: pnpm install:app --apply');
  process.exit(0);
}

const incoming = join(target, `.${APP_NAME}.incoming`);
const previous = join(target, `.${APP_NAME}.previous`);
rmSync(incoming, { recursive: true, force: true });
rmSync(previous, { recursive: true, force: true });
execFileSync('ditto', [built, incoming]);
if (existsSync(installed)) renameSync(installed, previous);
renameSync(incoming, installed);
rmSync(previous, { recursive: true, force: true });
console.log(`\nInstalled ${installed}. Open it from Applications or Spotlight.`);
