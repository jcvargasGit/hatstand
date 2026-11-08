import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readReleaseStatus } from '../../src/main/release';

const script = resolve(__dirname, '../../scripts/release.mjs');
const FAKE_INSTALLER = `import { appendFileSync } from 'node:fs';
appendFileSync(process.env.RELEASE_LOG, 'installer ' + process.argv.slice(2).join(' ') + ' in ' + process.cwd() + '\\n');
if (process.argv.includes('--apply')) console.log('Installed');
`;

let root: string;
let repo: string;
let dev: string;
let apps: string;
let log: string;
let bin: string;
let running: ChildProcess[];

const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
const env = () => ({ HOME: root, HATSTAND_HOME: dev, HATSTAND_INSTALL_DIR: apps, RELEASE_LOG: log, GIT_CONFIG_GLOBAL: '/dev/null', PATH: [bin, dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter) });
const release = (cwd = repo) => spawnSync(process.execPath, [script], { cwd, encoding: 'utf8', env: env() });
const state = () => JSON.parse(readFileSync(join(dev, 'release.json'), 'utf8'));
const steps = () => (existsSync(log) ? readFileSync(log, 'utf8') : '');
const keepAlive = (...argv: string[]) => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', ...argv], { stdio: 'ignore' });
  running.push(child);
  return child;
};
const openApp = () => keepAlive(`${apps}/Hatstand.app/Contents/MacOS/Hatstand`);
const reached = async (name: string) => vi.waitFor(() => expect(state().state).toBe(name), { timeout: 15000, interval: 100 });

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-release-')));
  repo = join(root, 'main-folder');
  dev = join(root, 'dev');
  apps = join(root, 'Applications');
  log = join(root, 'steps.log');
  bin = join(root, 'bin');
  running = [];
  for (const folder of [join(repo, 'scripts'), bin, apps]) mkdirSync(folder, { recursive: true });
  writeFileSync(join(bin, 'pnpm'), `#!/bin/sh\necho "pnpm $* in $PWD" >> "$RELEASE_LOG"\n`);
  chmodSync(join(bin, 'pnpm'), 0o755);
  writeFileSync(join(repo, 'scripts/install-app.mjs'), FAKE_INSTALLER);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'first');
});

afterEach(() => {
  running.forEach((child) => child.kill());
  rmSync(root, { recursive: true, force: true });
});

describe('pnpm release', () => {
  it('builds main and installs it when the app is closed', () => {
    const { status, stdout } = release();
    expect(status).toBe(0);
    expect(stdout).toContain('is installed');
    expect(state()).toMatchObject({ state: 'installed', version: git('rev-parse', '--short=7', 'main') });
    expect(steps().split('\n').filter(Boolean)).toEqual([`pnpm install --frozen-lockfile in ${repo}`, `installer --build-only in ${repo}`, `installer --apply in ${repo}`]);
  });

  it('builds from the folder of main, even when started from another worktree', () => {
    const other = join(root, 'other');
    git('worktree', 'add', '-q', '-b', 'feature', other);
    expect(release(other).status).toBe(0);
    expect(steps()).toContain(`installer --build-only in ${repo}`);
    expect(steps()).not.toContain(`in ${other}`);
  });

  it('refuses when main has changes that are not committed', () => {
    writeFileSync(join(repo, 'scripts/install-app.mjs'), `${FAKE_INSTALLER}// edited\n`);
    expect(release().status).toBe(1);
    expect(state()).toMatchObject({ state: 'failed', message: expect.stringContaining('not committed') });
    expect(steps()).toBe('');
  });

  it('refuses when Hatstand runs from the folder of main, whose packages it would reinstall', async () => {
    keepAlive(`${repo}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`);
    expect(release().status).toBe(1);
    expect(state().message).toContain('Close it first');
    expect(steps()).toBe('');
  });

  it('reports when a step of the build fails', () => {
    writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\nexit 1\n');
    expect(release().status).toBe(1);
    expect(state()).toMatchObject({ state: 'failed', message: expect.stringContaining('The build failed') });
  });

  it('never replaces an open app: it waits, and installs when the app closes', async () => {
    const app = openApp();
    const waiting = spawn(process.execPath, [script], { cwd: repo, stdio: 'ignore', env: env() });
    running.push(waiting);
    await reached('waiting');
    expect(steps()).not.toContain('--apply');
    app.kill();
    await reached('installed');
    expect(steps()).toContain('--apply');
  });

  it('replaces a waiting update with a newer one, but not one still building', async () => {
    openApp();
    running.push(spawn(process.execPath, [script], { cwd: repo, stdio: 'ignore', env: env() }));
    await reached('waiting');
    const firstPid = state().pid;
    running.push(spawn(process.execPath, [script], { cwd: repo, stdio: 'ignore', env: env() }));
    await vi.waitFor(() => expect(state().pid).not.toBe(firstPid), { timeout: 15000, interval: 100 });
    await reached('waiting');

    writeFileSync(join(dev, 'release.json'), JSON.stringify({ state: 'building', version: 'x', pid: process.pid }));
    const second = release();
    expect(second.status).toBe(1);
    expect(second.stderr).toContain('already being built');
    expect(state().pid).toBe(process.pid);
  });
});

describe('the status of an update', () => {
  const read = () => readReleaseStatus({ home: dev, appRoot: repo, path: env().PATH });

  beforeEach(() => {
    vi.stubEnv('HATSTAND_INSTALL_DIR', apps);
    mkdirSync(dev, { recursive: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is idle before the first update, and knows the app is not installed', () => {
    expect(read()).toEqual({ state: 'idle', installedVersion: null, mainVersion: git('rev-parse', '--short=7', 'main'), commitsOutsideMain: 0 });
  });

  it.runIf(process.platform === 'darwin')('reads the version of the installed app', () => {
    const contents = join(apps, 'Hatstand.app/Contents');
    mkdirSync(contents, { recursive: true });
    writeFileSync(join(contents, 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleVersion</key><string>abc1234</string></dict></plist>');
    expect(read().installedVersion).toBe('abc1234');
  });

  it('counts the commits of this folder that are not in main', () => {
    git('checkout', '-q', '-b', 'feature');
    git('commit', '-q', '--allow-empty', '-m', 'work');
    expect(read().commitsOutsideMain).toBe(1);
  });

  it('says an update was interrupted when its process is gone', () => {
    const gone = spawnSync(process.execPath, ['-e', '0']).pid;
    writeFileSync(join(dev, 'release.json'), JSON.stringify({ state: 'waiting', version: 'abc', pid: gone }));
    expect(read()).toMatchObject({ state: 'failed', version: 'abc', message: expect.stringContaining('interrupted') });
  });

  it('keeps a finished update and ignores a damaged file', () => {
    writeFileSync(join(dev, 'release.json'), JSON.stringify({ state: 'installed', version: 'abc', pid: 1 }));
    expect(read()).toMatchObject({ state: 'installed', version: 'abc' });
    writeFileSync(join(dev, 'release.json'), 'not json');
    expect(read().state).toBe('idle');
  });
});
