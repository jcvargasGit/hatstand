// A task whose agent writes in a folder without git: Changes lists those files with their full path,
// and each one opens in the editor.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hiddenWindowEnv } from './hidden-window.mjs';
import { shortcut, testKeychainEnv } from './platform.mjs';

const appRoot = new URL('../..', import.meta.url).pathname;
const { _electron: electron } = createRequire(`${appRoot}package.json`)('playwright-core');
const shots = process.env.HATSTAND_SHOTS;
const root = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-outside-')));
const home = join(root, 'home');
const bin = join(root, 'bin');
const editorLog = join(root, 'editor.log');

// The agent works for one turn when it gets Enter: it writes one file as a shell command would, and one
// as its Write tool would, which its hook records in the activity file.
mkdirSync(bin);
writeFileSync(
  join(bin, 'claude'),
  `#!${process.execPath}
const { appendFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
if (process.argv.includes('--version')) { console.log('1.0.0'); process.exit(0); }
if (process.argv.includes('auth')) { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
process.stdout.write('fake agent ready\\r\\n');
process.stdin.setRawMode(true);
let worked = false;
process.stdin.on('data', (data) => {
  process.stdout.write(data.toString());
  if (worked || !data.toString().includes('\\r')) return;
  worked = true;
  writeFileSync(process.env.HATSTAND_STATUS_FILE, 'working');
  setTimeout(() => {
    mkdirSync(join(process.cwd(), 'notes'), { recursive: true });
    writeFileSync(join(process.cwd(), 'notes', 'by-shell.md'), '# Written with a shell command\\n');
    const byTool = join(process.cwd(), 'by-tool.md');
    writeFileSync(byTool, '# Written with a tool\\n');
    appendFileSync(process.env.HATSTAND_ACTIVITY_FILE, JSON.stringify({ hook_event_name: 'HatstandFileWrite', kind: 'create', file_path: byTool }) + '\\n');
    writeFileSync(process.env.HATSTAND_STATUS_FILE, 'idle');
  }, 3000);
});
`,
);
chmodSync(join(bin, 'claude'), 0o755);
writeFileSync(join(bin, 'code'), `#!/bin/sh\nprintf '%s\\n' "$@" >> "${editorLog}"\n`);
chmodSync(join(bin, 'code'), 0o755);

const app = await electron.launch({
  args: [appRoot, '--use-mock-keychain'],
  cwd: appRoot,
  env: { ...process.env, ...hiddenWindowEnv, ...testKeychainEnv, HATSTAND_HOME: home, HATSTAND_PATH: `${bin}:/usr/bin:/bin`, HATSTAND_NODE: process.execPath, HATSTAND_SKIP_QUIT_PROMPT: '1' },
});

try {
  const page = await app.firstWindow();
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.setViewportSize({ width: 1280, height: 860 });
  const invoke = (method, ...args) => page.evaluate(([name, input]) => window.hatstand.invoke(name, ...input), [method, args]);
  const until = async (check, label) => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await check()) return;
      await page.waitForTimeout(250);
    }
    assert.fail(`Timed out waiting: ${label}`);
  };

  const company = await invoke('createCompany', 'Acme', '#5BB8A6');
  const task = await invoke('createTask', { companyId: company.id, title: 'Write the plan' });
  const session = await invoke('startSession', task.id);
  assert.equal(existsSync(join(session.cwd, '.git')), false, 'The agent works in a folder without git.');
  assert.deepEqual((await invoke('taskOutsideChanges', task.id)).folders, [], 'Nothing is listed before the agent writes.');

  const statusFile = join(home, 'run', `${session.id}.status`);
  await until(async () => {
    if (readFileSync(statusFile, 'utf8').trim() !== 'idle') return true;
    await invoke('writeSession', session.id, '\r');
    return false;
  }, 'the agent to start its turn');
  await until(() => readFileSync(statusFile, 'utf8').trim() === 'idle', 'the agent to end its turn');

  const byShell = join(session.cwd, 'notes', 'by-shell.md');
  const byTool = join(session.cwd, 'by-tool.md');
  // The file written with a tool is listed at once. The other one is found when the app sees the turn end, on its next poll.
  await until(async () => (await invoke('taskOutsideChanges', task.id)).folders.flatMap((folder) => folder.changes).length === 2, 'the changes of the turn to be recorded');
  const found = await invoke('taskOutsideChanges', task.id);
  assert.deepEqual(
    found.folders.flatMap((folder) => folder.changes),
    [
      { path: byTool, status: 'added' },
      { path: byShell, status: 'added' },
    ],
    'Changes lists the file written with a tool and the one written with a shell command, with their full path.',
  );
  assert.deepEqual(await invoke('taskChanges', task.id), [], 'No repository changed.');
  assert.equal(await invoke('taskOutsideFile', task.id, byShell), '+# Written with a shell command');
  await assert.rejects(invoke('taskOutsideFile', task.id, join(home, 'accounts.yaml')), /not among the changes/, 'A file Hatstand did not record is refused.');
  await assert.rejects(invoke('openTaskChangedFile', task.id, join(home, 'accounts.yaml')), /not among the changes/);

  await page.getByRole('button', { name: 'Write the plan' }).first().click();
  await page.keyboard.press(shortcut('1'));
  const changes = page.getByRole('region', { name: 'Changes' });
  const outside = changes.getByRole('group', { name: 'Outside git' });
  await outside.getByText(byShell, { exact: true }).waitFor();
  await outside.getByText(byTool, { exact: true }).waitFor();
  await changes.getByText('2 files outside git').waitFor();
  if (shots) await page.screenshot({ path: join(shots, 'o-outside-git.png') });

  await outside.getByTitle(byShell).click();
  await page.getByLabel(`Changes in ${byShell}`).getByText('+# Written with a shell command').waitFor();
  await outside.getByRole('button', { name: `Open ${byShell} in editor` }).click();
  await until(() => existsSync(editorLog) && readFileSync(editorLog, 'utf8').split('\n').includes(byShell), 'the file to open in the editor');

  await invoke('stopSession', session.id);
  assert.deepEqual(failures, []);
  console.log('outside changes test passed');
} finally {
  await app.close();
  rmSync(root, { recursive: true, force: true });
}
