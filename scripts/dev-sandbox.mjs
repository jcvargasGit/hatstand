// Opens Hatstand with made-up data and a fake `claude`, for a machine with no agent signed in.
// Run `pnpm dev:sandbox`. Add --fresh to start over, or --check to prepare without opening the app.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { stringify } from 'yaml';

const appRoot = resolve(import.meta.dirname, '..');
const flags = new Set(process.argv.slice(2));
const root = resolve(process.env.HATSTAND_SANDBOX_DIR ?? join(tmpdir(), 'hatstand-sandbox'));
const home = join(root, 'home');
const bin = join(root, 'bin');
const log = join(root, 'log');
const clientFolder = join(root, 'clients', 'acme');
const repo = join(clientFolder, 'acme-api');

const installedDist = join(appRoot, 'node_modules', 'electron', 'dist');

// Returns the folder that holds Electron, and whether it came from the electron package.
function findElectron() {
  if (process.env.ELECTRON_OVERRIDE_DIST_PATH) return { dir: process.env.ELECTRON_OVERRIDE_DIST_PATH, installed: false };
  // The package writes path.txt even when it could not download Electron, so check the file itself.
  const pathFile = join(appRoot, 'node_modules', 'electron', 'path.txt');
  if (existsSync(pathFile) && existsSync(join(installedDist, readFileSync(pathFile, 'utf8').trim()))) return { dir: installedDist, installed: true };
  const executable = process.platform === 'darwin' ? 'Electron.app' : 'electron';
  const dir = ['/workspace', dirname(appRoot)].find((candidate) => existsSync(join(candidate, executable)));
  return dir ? { dir, installed: false } : null;
}

// Electron's sandbox needs a helper owned by root with the setuid bit, which an unzipped or user-installed Electron lacks.
function needsNoSandbox(electronDir) {
  if (process.platform !== 'linux' || !electronDir) return false;
  const helper = join(electronDir, 'chrome-sandbox');
  if (!existsSync(helper)) return true;
  const { uid, mode } = statSync(helper);
  return uid !== 0 || (mode & 0o4000) === 0;
}

function writeFakeAgent() {
  mkdirSync(bin, { recursive: true });
  const agent = join(bin, 'claude');
  writeFileSync(agent, `#!/bin/sh\nexec "${process.execPath}" "${join(appRoot, 'scripts', 'fake-claude.cjs')}" "$@"\n`);
  chmodSync(agent, 0o755);
}

function seedClient() {
  if (existsSync(join(home, 'companies', 'acme', 'company.yaml'))) return false;
  mkdirSync(repo, { recursive: true });
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Sandbox', '-c', 'user.email=sandbox@example.com', ...args], { cwd: repo, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '# acme-api\n\nA made-up repository for trying Hatstand.\n');
  git('add', '.');
  git('commit', '-q', '-m', 'Start the made-up repository');

  const company = {
    id: 'acme',
    name: 'Acme',
    color: '#3b82f6',
    origin: 'existing',
    hasCode: true,
    rootDir: clientFolder,
    confirmedSteps: ['knowledge', 'llm-config'],
    subdomains: [{ id: 'core', name: 'Core', folder: 'core', description: 'Tasks that belong to no other area.', folders: [], links: [] }],
    defaultAreaId: 'core',
    projects: [{ id: 'acme-api', name: 'acme-api', path: repo }],
    links: [{ id: 'docs', label: 'Docs', url: 'https://example.com/docs' }],
  };
  const now = new Date().toISOString();
  const task = {
    id: randomUUID(),
    companyId: 'acme',
    title: 'Try a session with the fake agent',
    description: 'Open this task and start a session. The terminal shows the fake claude, which echoes what you type.',
    status: 'todo',
    subdomainId: 'core',
    projectIds: ['acme-api'],
    createdAt: now,
    updatedAt: now,
  };
  const companyDir = join(home, 'companies', 'acme');
  mkdirSync(join(companyDir, 'tasks'), { recursive: true, mode: 0o700 });
  writeFileSync(join(companyDir, 'company.yaml'), stringify(company), { mode: 0o600 });
  writeFileSync(join(companyDir, 'tasks', `${task.id}.json`), JSON.stringify(task, null, 2), { mode: 0o600 });
  return true;
}

if (flags.has('--fresh')) rmSync(root, { recursive: true, force: true });
mkdirSync(home, { recursive: true, mode: 0o700 });
writeFakeAgent();
const seeded = seedClient();
const electron = findElectron();

const env = {
  ...process.env,
  HATSTAND_HOME: home,
  HATSTAND_PATH: [bin, process.env.PATH ?? '/usr/bin:/bin'].join(delimiter),
  HATSTAND_NODE: process.execPath,
  HATSTAND_SANDBOX_LOG: log,
  // The sandbox's data is made up, so on Linux, which may have no keychain, its keys use a key that is not secret.
  ...(process.platform === 'linux' ? { HATSTAND_TEST_KEYCHAIN: '1' } : {}),
  ...(electron && !electron.installed ? { ELECTRON_OVERRIDE_DIST_PATH: electron.dir } : {}),
  ...(needsNoSandbox(electron?.dir) ? { NO_SANDBOX: '1' } : {}),
};

const summary = { root, home, launches: join(log, 'launches.jsonl'), seeded, electron: electron?.dir ?? 'missing' };
if (flags.has('--check')) {
  console.log(JSON.stringify({ ...summary, env: Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith('HATSTAND_') || key.startsWith('ELECTRON_') || key === 'NO_SANDBOX')) }, null, 2));
  process.exit(0);
}
if (!electron) {
  console.error('Electron is not installed. Add the Electron zip for this machine with "Add an archive" (it unzips into /workspace), then run pnpm dev:sandbox again.');
  process.exit(1);
}
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  console.error('There is no screen. Run pnpm dev:sandbox from a terminal on the desktop.');
  process.exit(1);
}

console.log(`Hatstand sandbox: data in ${home}`);
console.log(`Each agent launch is recorded in ${summary.launches}`);
const { status } = spawnSync(process.execPath, [join(appRoot, 'scripts', 'dev.mjs'), 'dev'], { stdio: 'inherit', env, cwd: appRoot });
process.exit(status ?? 1);
