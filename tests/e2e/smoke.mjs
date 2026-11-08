// Launches the built app with a throwaway data folder and a fake `claude`,
// so it needs no account and touches none of your real client data.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';
import { hiddenWindowEnv } from './hidden-window.mjs';
import { shortcut, testKeychainEnv } from './platform.mjs';

const appRoot = resolve(import.meta.dirname, '../..');
const shots = process.env.HATSTAND_SHOTS;
const root = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-e2e-')));
const home = join(root, 'home');
const bin = join(root, 'bin');
const repo = join(root, 'acme-api');
const record = join(root, 'claude-launch.json');

mkdirSync(bin);
mkdirSync(repo);
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });

writeFileSync(
  join(bin, 'claude'),
  `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args: process.argv.slice(2), env: process.env, cwd: process.cwd() }));
console.log('fake claude is ready');
fs.writeFileSync(process.env.HATSTAND_STATUS_FILE, 'needs-input');
process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => {
  process.stdout.write('heard: ' + chunk.toString());
  if (chunk.toString().includes('q')) process.exit(0);
});
`,
);
chmodSync(join(bin, 'claude'), 0o755);
const editorLog = join(root, 'editor.log');
writeFileSync(join(bin, 'code'), `#!/bin/sh\nprintf '%s\\n' "$@" >> "${editorLog}"\n`, { mode: 0o755 });

const shot = async (page, name) => {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
};

const app = await electron.launch({
  args: [appRoot, '--use-mock-keychain'],
  cwd: appRoot,
  env: {
    ...process.env,
    ...hiddenWindowEnv, ...testKeychainEnv,
    HATSTAND_HOME: home,
    HATSTAND_PATH: `${bin}:/usr/bin:/bin`,
    HATSTAND_NODE: process.execPath,
    HATSTAND_SKIP_QUIT_PROMPT: '1',
    OTHER_CLIENT_TOKEN: 'must-not-reach-the-agent',
  },
});

const invoke = (page, method, ...args) =>
  page.evaluate(([name, input]) => window.hatstand.invoke(name, ...input), [method, args]);

const failures = [];
try {
  const page = await app.firstWindow();
  if (hiddenWindowEnv.HATSTAND_HEADLESS) {
    const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.isVisible()));
    assert.equal(visible, false, 'the test window must stay hidden');
  }
  page.on('pageerror', (error) => failures.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const { url, lineNumber } = message.location();
      failures.push(`console: ${message.text()} at ${url}:${lineNumber}`);
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole('heading', { name: 'Add your first client' }).waitFor();
  await shot(page, '1-first-client');
  await page.getByLabel('Client or project name').fill('Acme Studio');
  await page.getByLabel(/I already have folders/).check();
  await page.getByRole('main').getByRole('button', { name: 'Add client' }).click();

  await page.getByRole('heading', { name: 'Where is the code?' }).waitFor();
  await shot(page, '2a-setup-repositories');
  await page.getByLabel('Folder with your repositories, full path').fill(root);
  await page.getByLabel('Folder with your repositories, full path').press('Enter');
  await page.getByText('Found 1 repository and added 1.').waitFor();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Areas of this client' }).waitFor();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Client planning' }).waitFor();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'LLM config', exact: true }).waitFor();
  const pluginFolder = join(home, 'companies', 'acme-studio', 'plugin');
  const skillsFolder = join(pluginFolder, 'skills');
  await page.getByText(pluginFolder, { exact: true }).waitFor();
  assert.ok(existsSync(join(home, 'companies', 'acme-studio', 'plugin', '.claude-plugin', 'plugin.json')));
  await shot(page, '2b-setup-skills');
  mkdirSync(join(skillsFolder, 'deploy'));
  writeFileSync(join(skillsFolder, 'deploy', 'SKILL.md'), '---\nname: deploy\ndescription: test\n---\n');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Client knowledge' }).waitFor();
  await shot(page, '2c-setup-knowledge');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Keys and tools' }).waitFor();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('heading', { name: 'Links of this client' }).waitFor();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('heading', { name: 'Who commits for this client?' }).waitFor();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('heading', { name: 'Protect commits' }).waitFor();
  await page.getByRole('button', { name: 'Protect repositories' }).click();
  await page.getByText('Protected 1 repository').waitFor();
  await shot(page, '2d-setup-protection');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Task guides' }).waitFor();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Review' }).waitFor();
  await page.getByRole('region', { name: 'Client setup' }).getByText('67%').waitFor();
  await shot(page, '2e-setup-review');
  await page.getByRole('button', { name: 'Go to tasks' }).click();
  await page.getByRole('heading', { name: 'Acme Studio' }).waitFor();

  const repos = await invoke(page, 'scanRepos', root);
  assert.deepEqual(repos.map((item) => item.name), ['acme-api']);

  const [acme] = (await invoke(page, 'getSnapshot')).companies;
  await invoke(page, 'saveCompany', {
    ...acme,
    subdomains: [{ id: 'uploads', name: 'Uploads' }],
    projects: [{ id: 'api', name: 'acme-api', path: repo, subdomainId: 'uploads' }],
  });
  await invoke(page, 'setSecret', acme.id, 'ACME_API_TOKEN', 'acme-secret-value-123');
  const other = await invoke(page, 'createCompany', 'Nimbus Labs', '#8FA6F0');
  await invoke(page, 'setSecret', other.id, 'NIMBUS_API_TOKEN', 'nimbus-secret-value-456');
  await invoke(page, 'createTask', { companyId: other.id, title: 'Review the photo export' });
  await page.reload();

  assert.ok(existsSync(join(home, 'companies', acme.id, 'secrets.enc')));
  assert.ok(!readFileSync(join(home, 'companies', acme.id, 'secrets.enc')).includes('acme-secret-value-123'));

  const report = await invoke(page, 'installGuard', acme.id);
  assert.deepEqual(report.installed, [repo]);

  await page.getByRole('button', { name: /^Acme Studio/ }).first().click();
  await page.getByRole('button', { name: 'New task for Acme Studio' }).click();
  await page.getByLabel('Task title').fill('Retry failed uploads');
  await page.getByRole('checkbox', { name: 'acme-api' }).check();
  await shot(page, '2-new-task');
  await page.getByRole('button', { name: 'Create task' }).click();
  await page.getByRole('heading', { name: 'Retry failed uploads' }).waitFor();
  await page.getByRole('region', { name: 'Task', exact: true }).getByText(/^#\d+$/).waitFor();
  await page.getByRole('tab', { name: 'Details' }).click();
  await page.getByRole('button', { name: 'Edit in VS Code' }).click();
  const notedTask = (await invoke(page, 'getSnapshot')).tasks.find((item) => item.title === 'Retry failed uploads');
  const notesFile = join(home, 'companies', notedTask.companyId, 'tasks', `${notedTask.id}.md`);
  await page.waitForTimeout(500);
  assert.ok(readFileSync(editorLog, 'utf8').includes(notesFile), 'task notes open in the editor');
  writeFileSync(notesFile, 'Next: reproduce the timeout.\n');
  await page.getByText('Next: reproduce the timeout.').waitFor();
  await shot(page, '2-task');
  await page.getByRole('tab', { name: 'Overview' }).click();
  const reportFile = notesFile.replace(/\.md$/, '.report.md');
  writeFileSync(reportFile, '# Findings\n\nThe timeout comes from the retry queue.\n');
  await page.getByRole('button', { name: 'Read report.md' }).click();
  await page.getByText('The timeout comes from the retry queue.').waitFor();
  await shot(page, '2-agent-output');
  await page.getByRole('button', { name: 'Open report.md in VS Code' }).click();
  await page.waitForTimeout(500);
  assert.ok(readFileSync(editorLog, 'utf8').includes(reportFile), 'a report of the agent opens in the editor');
  await page.getByRole('tab', { name: 'Details' }).click();

  await invoke(page, 'createTask', { companyId: notedTask.companyId, title: 'Task created later' });
  await page.getByRole('button', { name: 'Start session' }).click();
  await page.getByTestId('terminal').getByText('fake claude is ready').waitFor({ timeout: 15000 });
  await page.getByRole('region', { name: 'Task', exact: true }).getByText('Needs your answer').waitFor({ timeout: 10000 });
  const treeTitles = await page.getByRole('region', { name: 'Acme Studio tasks' }).locator('.tree-task-title').allInnerTexts();
  const treePosition = (title) => treeTitles.findIndex((text) => text.includes(title));
  assert.ok(treePosition('Task created later') !== -1 && treePosition('Task created later') < treePosition('Retry failed uploads'), `a running task keeps its place: ${treeTitles}`);
  await page.getByTestId('terminal').getByText('heard: Step 1 of 8, Understand the task').waitFor({ timeout: 10000 });
  assert.ok(!(await page.getByTestId('terminal').innerText()).includes('heard: \r'), 'the prompt waits for Enter');
  await shot(page, '3-session-waiting');

  const launch = JSON.parse(readFileSync(record, 'utf8'));
  assert.equal(launch.cwd, root, 'the session opens in the folder with every repository');
  assert.equal(launch.env.ACME_API_TOKEN, 'acme-secret-value-123', 'the client key reaches the agent');
  assert.equal(launch.env.NIMBUS_API_TOKEN, undefined, 'another client key stays out');
  assert.equal(launch.env.OTHER_CLIENT_TOKEN, undefined, 'the app environment stays out');
  assert.ok(launch.args.includes('--session-id'));
  const localPlugin = join(home, 'companies', 'acme-studio', 'plugin');
  assert.equal(launch.args[launch.args.indexOf('--plugin-dir') + 1], localPlugin, 'the client skills folder reaches the agent');
  assert.ok(!launch.args.includes('--dangerously-skip-permissions'));

  const promptFile = launch.args[launch.args.indexOf('--append-system-prompt-file') + 1];
  const prompt = readFileSync(promptFile, 'utf8');
  assert.ok(prompt.includes('Next: reproduce the timeout.'), 'saved notes reach the agent');
  assert.ok(prompt.includes('Client: Acme Studio'));
  assert.ok(prompt.includes(`- acme-api (${repo})`), 'the chosen repositories reach the agent');
  assert.ok(!launch.args.some((arg) => arg.startsWith('Review the task')), 'no prompt is sent by itself');
  assert.ok(!prompt.includes('Nimbus'), 'another client stays out of the prompt');

  await page.getByRole('button', { name: 'Full screen', exact: true }).click();
  await page.locator('.panel.is-terminal-full').waitFor();
  const fullBox = await page.locator('.panel.is-terminal-full').boundingBox();
  const windowSize = page.viewportSize();
  assert.deepEqual([fullBox.x, fullBox.y, fullBox.width, fullBox.height], [0, 0, windowSize.width, windowSize.height], 'the terminal takes the whole window');
  assert.equal(await page.locator('.panel-head').isVisible(), false, 'the task header makes room');
  await shot(page, '3b-terminal-full');
  await page.keyboard.press(shortcut('Enter'));
  await page.getByRole('button', { name: 'Full screen', exact: true }).waitFor();
  assert.equal(await page.locator('.panel-head').isVisible(), true);
  await page.getByTestId('terminal').click();
  await page.keyboard.type('x');
  await page.getByTestId('terminal').getByText('heard: x').waitFor();
  await page.keyboard.press('Shift+Enter');
  await page.waitForFunction(async () => {
    const { sessions } = await window.hatstand.invoke('getSnapshot');
    const buffers = await Promise.all(sessions.map((session) => window.hatstand.invoke('readSessionBuffer', session.id)));
    return buffers.some((buffer) => buffer.includes('heard: \x1b\r'));
  });

  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByText('Waiting for you').waitFor();
  await shot(page, '4-today');

  await page.getByRole('button', { name: /Retry failed uploads/ }).first().click();
  await page.getByTestId('terminal').getByText('heard: x').waitFor();
  await page.getByTestId('terminal').click();
  await page.keyboard.type('q');
  await page.getByRole('button', { name: 'Resume session' }).waitFor({ timeout: 10000 });
  await page.getByText('Last ran with').waitFor();
  await page.getByRole('button', { name: 'Resume session' }).click();
  await page.getByRole('button', { name: 'Stop session' }).waitFor({ timeout: 10000 });
  await page.getByTestId('terminal').getByText('fake claude is ready').nth(1).waitFor({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const resumed = JSON.parse(readFileSync(record, 'utf8'));
  assert.ok(resumed.args.includes('--resume'), 'resume continues the same conversation');
  await page.getByRole('button', { name: 'Stop session' }).click();
  await page.getByRole('button', { name: 'Resume session' }).waitFor({ timeout: 10000 });

  await page.getByRole('button', { name: /^Acme Studio/ }).first().click();
  await page.getByRole('tab', { name: 'Client settings' }).click();
  await page.getByRole('navigation', { name: 'Setup steps' }).waitFor();
  await page.getByRole('navigation', { name: 'Setup steps' }).getByRole('button', { name: /Keys/ }).click();
  await page.getByText('ACME_API_TOKEN').waitFor();
  assert.ok(!(await page.locator('body').innerText()).includes('acme-secret-value-123'), 'key values are never shown');
  await shot(page, '5-client-settings');

  const hiddenKnowledge = join(root, '.claude/companies/acme/knowledge');
  mkdirSync(hiddenKnowledge, { recursive: true });
  await page.getByRole('navigation', { name: 'Setup steps' }).getByRole('button', { name: /Knowledge/ }).click();
  const knowledgePath = page.getByLabel('Knowledge folder, full path');
  await knowledgePath.fill(join(root, '.claude/missing'));
  await knowledgePath.press('Enter');
  await page.getByText('does not exist').waitFor();
  await knowledgePath.fill(hiddenKnowledge);
  await knowledgePath.press('Enter');
  await page.locator('.active-folder').getByText(hiddenKnowledge).waitFor();
  const saved = (await invoke(page, 'getSnapshot')).companies.find((item) => item.id === acme.id);
  assert.equal(saved.context.knowledgeDir, hiddenKnowledge, 'a pasted hidden folder is saved');
  await shot(page, '5a-pasted-knowledge');

  await page.getByRole('navigation', { name: 'Setup steps' }).getByRole('button', { name: /Review/ }).click();
  const setup = page.getByRole('region', { name: 'Client setup' });
  await setup.getByText('67%').waitFor();
  await invoke(page, 'setSecret', acme.id, 'GITHUB_TOKEN', 'github-secret-value-789');
  await setup.getByText('83%').waitFor();
  await shot(page, '5g-setup-complete');
  await invoke(page, 'deleteSecret', acme.id, 'GITHUB_TOKEN');
  await setup.getByText("67%").waitFor();

  await page.getByRole('button', { name: /^Nimbus Labs/ }).click();
  await page.getByRole('button', { name: /Finish setup, 0% done/ }).waitFor();
  await page.getByRole('button', { name: /Review the photo export/ }).first().click();
  assert.equal(await page.getByRole('button', { name: 'Start session' }).isDisabled(), true, 'a client with no folder cannot start');
  await shot(page, '5h-client-not-ready');
  await page.getByRole('button', { name: 'Set up client' }).click();
  await page.getByRole('heading', { name: 'Where is the code?' }).waitFor();
  await page.getByRole('navigation', { name: 'Setup steps' }).getByRole('button', { name: /Review/ }).click();
  await page.getByRole('region', { name: 'Client setup' }).getByText('0%').waitFor();
  await shot(page, '5i-setup-empty');
  await page.getByRole('button', { name: /^Acme Studio/ }).first().click();
  await page.getByRole('tab', { name: 'Client settings' }).first().click();
  await page.getByRole('navigation', { name: 'Setup steps' }).waitFor();

  await assert.rejects(invoke(page, 'setClientPhoto', acme.id, 'http://example.com/logo.png'), /https/);
  await assert.rejects(invoke(page, 'setClientPhoto', acme.id, 'https://www.google.com/search?q=x'), /Copy image address/);
  if (process.env.HATSTAND_LIVE_PHOTO) {
    await invoke(page, 'setClientPhoto', acme.id, process.env.HATSTAND_LIVE_PHOTO);
    assert.ok(existsSync(join(home, 'companies', acme.id, 'photo')));
    await page.reload();
    await page.getByRole('button', { name: /^Acme Studio/ }).first().click();
    await page.locator('.sidebar img.avatar').waitFor();
    await page.getByRole('tab', { name: 'Client settings' }).click();
    await page.getByRole('navigation', { name: 'Setup steps' }).getByRole('button', { name: /Name/ }).click();
    await page.getByRole('button', { name: 'Remove photo' }).waitFor();
    assert.ok(await page.locator('.photo-field img.avatar').evaluate((image) => image.naturalWidth > 0), 'the photo renders');
    await shot(page, '5b-client-photo');
    await page.emulateMedia({ colorScheme: 'light' });
    await shot(page, '5c-client-photo-light');
    await page.getByRole('tab', { name: 'Tasks', exact: true }).click();
    await page.getByRole('button', { name: /Retry failed uploads/ }).first().click();
    await shot(page, '5d-task-light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await shot(page, '5e-task-dark');
    await page.getByRole('button', { name: /^Acme Studio/ }).first().click();
    await page.getByRole('tab', { name: 'Client settings' }).click();
    await page.getByRole('navigation', { name: 'Setup steps' }).getByRole('button', { name: /Name/ }).click();
    await page.getByRole('button', { name: 'Remove photo' }).waitFor();
    await shot(page, '5f-client-photo-dark');
  }

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('heading', { name: 'Add an account' }).waitFor();
  await shot(page, '6-agents');

  const guideSetting = page.getByRole('checkbox', { name: 'Start with the guide Implement a task' });
  assert.equal(await guideSetting.isChecked(), true, 'new tasks start with a guide by default');
  await guideSetting.click();
  await page.waitForFunction(() => document.querySelector('.settings-section input[type="checkbox"]')?.checked === false);
  assert.ok(readFileSync(join(home, 'preferences.yaml'), 'utf8').includes('guideNewTasks: false'), 'the setting is saved');

  assert.deepEqual(failures, [], 'the renderer reported no errors');
  console.log('smoke test passed');
} catch (error) {
  const page = await app.firstWindow();
  await shot(page, 'failure');
  console.error('renderer errors:', failures);
  console.error('sessions:', JSON.stringify((await invoke(page, 'getSnapshot')).sessions));
  console.error('terminal text:', await page.getByTestId('terminal').innerText().catch(() => '(no terminal)'));
  console.error('panel error:', await page.locator('.error').allInnerTexts());
  throw error;
} finally {
  await app.close();
  rmSync(root, { recursive: true, force: true });
}
