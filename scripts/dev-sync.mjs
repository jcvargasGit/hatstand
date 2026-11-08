// Copies your real clients and tasks into the development data folder. Run "pnpm dev:sync".
// The real folder is only read. Sessions and worktrees stay out, so nothing done in
// development can resume a real conversation or delete a real worktree.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const COPIED = ['companies', 'accounts.yaml', 'preferences.yaml'];
const CLEARED = ['sessions', 'run'];

const real = join(homedir(), '.hatstand');
const copy = join(homedir(), '.hatstand-dev');

const stop = (message) => {
  console.error(message);
  process.exit(1);
};

const folders = (path) => readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

const withoutWorktrees = (taskFile) => {
  const task = JSON.parse(readFileSync(taskFile, 'utf8'));
  writeFileSync(taskFile, JSON.stringify({ ...task, worktrees: [] }, null, 2));
};

if (!existsSync(real)) stop(`There is nothing to copy: ${real} does not exist.`);
const devIsOpen = spawnSync('pgrep', ['-f', 'electron-vite(\\.js)? (dev|preview)'], { stdio: 'ignore' }).status === 0;
if (devIsOpen && !process.argv.includes('--force')) stop('A copy of Hatstand started with "pnpm dev" is open. Close it, then run this again.');

mkdirSync(copy, { recursive: true, mode: 0o700 });
for (const name of [...COPIED, ...CLEARED]) rmSync(join(copy, name), { recursive: true, force: true });
for (const name of COPIED) {
  if (existsSync(join(real, name))) cpSync(join(real, name), join(copy, name), { recursive: true });
}

const companiesDir = join(copy, 'companies');
const companies = existsSync(companiesDir) ? folders(companiesDir) : [];
let tasks = 0;
for (const company of companies) {
  const tasksDir = join(companiesDir, company, 'tasks');
  if (!existsSync(tasksDir)) continue;
  for (const file of readdirSync(tasksDir).filter((name) => name.endsWith('.json'))) {
    withoutWorktrees(join(tasksDir, file));
    tasks += 1;
  }
}

console.log(`Copied ${companies.length} clients and ${tasks} tasks to ${copy}. Your real data was not changed.`);
