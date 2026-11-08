// Builds the app with "pnpm install:app" into a throwaway folder and starts it the way Finder does:
// short PATH and no LANG. Uses a throwaway data folder, a mock keychain and a fake agent.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';
import { hiddenWindowEnv } from './hidden-window.mjs';

const appRoot = resolve(import.meta.dirname, '../..');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-packaged-')));
const home = join(root, 'home');
const bin = join(root, 'bin');
const target = join(root, 'Applications');
const repo = join(root, 'code', 'sample-repo');
const record = join(root, 'agent.json');
for (const folder of [home, bin, target, repo]) mkdirSync(folder, { recursive: true });

const executable = (name, text) => {
  writeFileSync(join(bin, name), text);
  chmodSync(join(bin, name), 0o755);
};
executable('login-shell', `#!/bin/sh\nPATH="${bin}:/usr/bin:/bin"\nexport PATH\nexec /bin/sh -c "$2"\n`);
executable('node', `#!/bin/sh\nexec "${process.execPath}" "$@"\n`);
executable('code', '#!/bin/sh\nexit 0\n');
executable(
  'claude',
  `#!${process.execPath}
const fs = require('node:fs');
if (process.argv.includes('--version')) { console.log('1.0.0'); process.exit(0); }
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ lang: process.env.LANG, path: process.env.PATH, term: process.env.TERM }));
fs.writeFileSync(process.env.HATSTAND_STATUS_FILE, 'needs-input');
process.stdin.setRawMode(true);
process.stdin.on('data', (data) => process.stdout.write('heard: ' + data.toString()));
`,
);
execFileSync('git', ['init', '-q', repo]);

const installer = (...args) =>
  execFileSync('node', [join(appRoot, 'scripts/install-app.mjs'), ...args], { cwd: appRoot, encoding: 'utf8', env: { ...process.env, HATSTAND_INSTALL_DIR: target } });

const waitFor = async (check, what) => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`Timed out waiting for ${what}.`);
};

let app;
try {
  assert.match(installer(), /Installed/);
  const bundle = join(target, 'Hatstand.app');
  execFileSync('codesign', ['--verify', '--deep', bundle]);
  const built = execFileSync('plutil', ['-extract', 'CFBundleVersion', 'raw', join(bundle, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
  assert.equal(built, execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: appRoot, encoding: 'utf8' }).trim(), 'The app knows which commit it is.');

  const { HATSTAND_HEADLESS } = hiddenWindowEnv;
  app = await electron.launch({
    executablePath: join(bundle, 'Contents/MacOS/Hatstand'),
    args: ['--use-mock-keychain'],
    cwd: root,
    env: {
      HOME: home,
      USER: process.env.USER ?? 'test',
      SHELL: join(bin, 'login-shell'),
      PATH: '/usr/bin:/bin',
      HATSTAND_HOME: home,
      HATSTAND_SKIP_QUIT_PROMPT: '1',
      ...(HATSTAND_HEADLESS ? { HATSTAND_HEADLESS } : {}),
    },
  });
  const page = await app.firstWindow();
  const invoke = (method, ...args) => page.evaluate(([name, input]) => window.hatstand.invoke(name, ...input), [method, args]);
  await page.getByRole('heading', { name: 'Add your first client' }).waitFor();

  const about = await app.evaluate(({ app: electronApp, BrowserWindow, safeStorage }) => ({
    name: electronApp.getName(),
    packaged: electronApp.isPackaged,
    userData: electronApp.getPath('userData'),
    canEncrypt: safeStorage.isEncryptionAvailable(),
    visible: BrowserWindow.getAllWindows().some((window) => window.isVisible()),
  }));
  assert.equal(about.name, 'hatstand', 'Saved keys belong to the keychain entry of this name.');
  assert.equal(about.packaged, true);
  assert.ok(about.userData.startsWith(home), 'The test stays away from the data of the real app.');
  assert.equal(about.canEncrypt, true);
  if (HATSTAND_HEADLESS) assert.equal(about.visible, false, 'The test window stays hidden.');

  assert.equal(await invoke('getReleaseStatus'), null, 'Updating is only for development.');
  assert.equal(await page.getByRole('button', { name: 'Update installed app' }).count(), 0);

  const replaced = installer('--apply');
  assert.match(replaced, /nothing was replaced/, 'An open app is never replaced.');

  const company = await invoke('createCompany', 'Packaged Client', '#5BB8A6');
  await invoke('saveCompany', { ...company, projects: [{ id: 'sample', name: 'sample-repo', path: repo }] });
  await invoke('setSecret', company.id, 'FAKE_TEST_KEY', 'fake-value');
  assert.deepEqual(await invoke('listSecretNames', company.id), ['FAKE_TEST_KEY']);

  const guides = await invoke('listPlaybooks', company.id);
  assert.ok(JSON.stringify(guides).includes('name'), 'The built-in guides are inside the app.');
  await invoke('installGuard', company.id);
  assert.ok(existsSync(join(repo, '.git/hooks/pre-commit')), 'Commit protection installs from inside the app.');

  const task = await invoke('createTask', { companyId: company.id, title: 'Runs in the installed app' });
  const session = await invoke('startSession', task.id);
  await waitFor(() => existsSync(record), 'the agent to start');
  const agent = JSON.parse(readFileSync(record, 'utf8'));
  assert.equal(agent.term, 'xterm-256color');
  assert.ok(agent.path.split(':').includes(bin), 'The agent gets the PATH of the login shell, not the short one of Finder.');
  assert.match(agent.lang ?? '', /UTF-8/, 'The agent gets a UTF-8 language setting.');

  await waitFor(async () => (await invoke('getSnapshot')).sessions.find((item) => item.id === session.id)?.state === 'needs-input', 'the state the agent reported');
  await invoke('writeSession', session.id, 'ñ');
  await waitFor(async () => (await invoke('readSessionBuffer', session.id)).includes('heard: ñ'), 'the terminal to answer');

  await invoke('stopSession', session.id);
  await app.close();
  app = undefined;

  assert.match(installer('--apply'), /Installed/, 'A closed app can be replaced.');
  assert.ok(existsSync(join(bundle, 'Contents/MacOS/Hatstand')));
  console.log('packaged test passed');
} finally {
  await app?.close().catch(() => {});
  rmSync(root, { recursive: true, force: true });
}
