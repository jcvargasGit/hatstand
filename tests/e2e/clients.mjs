import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hiddenWindowEnv } from './hidden-window.mjs';
import { shortcut, testKeychainEnv } from './platform.mjs';

const appRoot = new URL('../..', import.meta.url).pathname;
const { _electron: electron } = createRequire(`${appRoot}package.json`)('playwright-core');
const shots = process.env.HATSTAND_SHOTS;
const root = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-clients-')));
const home = join(root, 'home');
const fakeUserHome = join(root, 'user');
const gitConfig = join(fakeUserHome, '.gitconfig');
const bin = join(root, 'bin');
const launchLog = join(root, 'launch.log');
mkdirSync(fakeUserHome);
mkdirSync(bin);
writeFileSync(gitConfig, '[user]\n\tname = Personal\n\temail = me@personal.dev\n[alias]\n\tst = status\n');
const gitEnv = { ...process.env, HOME: fakeUserHome, GIT_CONFIG_GLOBAL: gitConfig };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv }).trim();

const repo = join(fakeUserHome, 'clients', 'acme', 'api');
mkdirSync(repo, { recursive: true });
git(repo, 'init', '-q', '-b', 'main');
git(repo, 'commit', '-q', '--allow-empty', '-m', 'first');

writeFileSync(
  join(bin, 'claude'),
  `#!${process.execPath}
const fs = require('node:fs');
if (process.argv.includes('--version')) { console.log('1.0.0'); process.exit(0); }
if (process.argv.includes('auth')) { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
const promptAt = process.argv.indexOf('--append-system-prompt-file');
fs.appendFileSync(${JSON.stringify(launchLog)}, JSON.stringify({ cwd: process.cwd(), author: process.env.GIT_AUTHOR_EMAIL ?? null, prompt: promptAt > 0 ? fs.readFileSync(process.argv[promptAt + 1], 'utf8') : '' }) + '\\n');
process.stdout.write('fake agent ready\\r\\n');
process.stdin.setRawMode(true);
process.stdin.on('data', (data) => process.stdout.write(data.toString()));
`,
);
chmodSync(join(bin, 'claude'), 0o755);
const editorLog = join(root, 'editor.log');
writeFileSync(join(bin, 'code'), `#!/bin/sh\nprintf '%s\\n' "$@" >> "${editorLog}"\n`, { mode: 0o755 });

const app = await electron.launch({
  args: [appRoot, '--use-mock-keychain'],
  cwd: appRoot,
  env: { ...gitEnv, ...hiddenWindowEnv, ...testKeychainEnv, HATSTAND_HOME: home, HATSTAND_PATH: `${bin}:/usr/bin:/bin`, HATSTAND_NODE: process.execPath, HATSTAND_SKIP_QUIT_PROMPT: '1' },
});

try {
  const page = await app.firstWindow();
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.setViewportSize({ width: 1280, height: 860 });
  const invoke = (method, ...args) => page.evaluate(([name, input]) => window.hatstand.invoke(name, ...input), [method, args]);
  const shot = async (name) => {
    if (shots) await page.screenshot({ path: join(shots, `c-${name}.png`) });
  };
  const until = async (check, label) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await check()) return;
      await page.waitForTimeout(250);
    }
    assert.fail(`Timed out waiting: ${label}`);
  };
  const noSidewaysOverflow = async (selector, label) => {
    const overflowing = await page.evaluate((target) => {
      const main = document.querySelector(target);
      if (!main) return ['missing'];
      const limit = main.getBoundingClientRect().right + 1;
      return [...main.querySelectorAll('*')].filter((element) => element.getBoundingClientRect().right > limit && !element.closest('pre, textarea')).map((element) => `${element.tagName}.${element.className}`).slice(0, 5);
    }, selector);
    assert.deepEqual(overflowing, [], `${label} goes past the edge.`);
    assert.equal(await page.evaluate((target) => { const main = document.querySelector(target); return main.scrollWidth > main.clientWidth + 1; }, selector), false, `${label} scrolls sideways.`);
  };

  const platform = await invoke('createCompany', 'Harbor Studio', '#8FA6F0');
  const acme = await invoke('createCompany', 'Acme', '#5BB8A6');
  await invoke('saveCompany', { ...acme, projects: [{ id: 'api', name: 'api', path: repo }] });
  await page.reload();
  page.on('pageerror', (error) => failures.push(error.message));
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.getByRole('button', { name: 'Search everything' }).first().waitFor();

  // Inbox: a sublist becomes the checklist of its parent, and it says what it will add.
  await page.getByRole('button', { name: 'Acme', exact: true }).waitFor();
  await page.keyboard.press(shortcut('i'));
  await page.getByRole('heading', { name: 'Inbox', exact: true }).waitFor();
  await page.locator(".inbox-capture select").selectOption(platform.id);
  await page.getByText('A new line alone adds details, not a task.').waitFor();
  const long = 'Una frase inventada y muy larga para probar que una lista con sublistas se ve bien y que el texto largo no se salga nunca de la pantalla aunque la ventana sea angosta';
  await page.getByLabel('Paste or write what you have in mind').fill(`- Primera tarea\n  - Leer el resumen\n  - Hacer la prueba\n- Segunda tarea\n- ${long}`);
  await page.getByRole('status').getByText('This adds 3 tasks to the inbox, with 2 checklist items.').waitFor();
  await page.getByRole('list', { name: 'Tasks to add' }).getByText('Leer el resumen').waitFor();
  await shot('inbox-preview');
  await page.getByRole('button', { name: 'Add 3 tasks' }).click();
  const group = page.getByRole('region', { name: 'Harbor Studio inbox' });
  await group.getByText('3 tasks to review').waitFor();
  await group.locator('td.idea-col-checklist').getByText('0 of 2 done').waitFor();
  const titles = () => group.locator('.idea-toggle span').allInnerTexts();
  assert.deepEqual((await titles()).slice(0, 2), ['Primera tarea', 'Segunda tarea'], 'A pasted list keeps its order.');

  // Order and priority.
  await group.getByRole('button', { name: 'Move Segunda tarea up' }).click();
  await until(async () => (await titles())[0] === 'Segunda tarea', 'moving a task up');
  await group.locator('.idea-row').nth(0).locator('.idea-grip').dragTo(group.locator('.idea-row').nth(1));
  await until(async () => (await titles())[0] === 'Primera tarea', 'dragging a task');
  await group.getByLabel(/^Priority of Una frase/).selectOption('high');
  await group.getByRole('button', { name: 'Sort by priority' }).click();
  await until(async () => (await titles())[0].startsWith("Una frase"), 'sorting by priority');
  await shot('inbox-list');

  // A row opens its details beside the table, and Escape saves and closes them.
  const details = page.getByRole('complementary', { name: 'Inbox item details' });
  await group.getByRole('button', { name: 'Segunda tarea', exact: true }).click();
  await details.getByRole('textbox', { name: 'Details' }).fill('Lo que se sabe hasta ahora');
  const tableBox = await group.locator('table').boundingBox();
  const detailsBox = await details.boundingBox();
  assert.ok(tableBox.x + tableBox.width <= detailsBox.x + 1, 'A wide window shows the details beside the table.');
  await shot('inbox-details');
  await page.keyboard.press('Escape');
  await details.waitFor({ state: 'detached' });
  await group.getByText('Lo que se sabe hasta ahora').first().waitFor();

  // Long text stays inside the page, at a large, a normal and a narrow size.
  await page.setViewportSize({ width: 2560, height: 1300 });
  await page.waitForTimeout(150);
  await noSidewaysOverflow('.inbox-page', 'The large inbox');
  const large = await page.evaluate(() => ({ table: document.querySelector('.inbox-table').getBoundingClientRect().width, page: document.querySelector('.inbox-page').getBoundingClientRect().width }));
  assert.ok(large.table > large.page * 0.9, 'The table uses the width of a large window.');
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.waitForTimeout(150);
  await noSidewaysOverflow('.inbox-page', 'The inbox');
  await page.setViewportSize({ width: 640, height: 760 });
  await page.waitForTimeout(150);
  await noSidewaysOverflow('.inbox-page', 'The narrow inbox');
  await shot('inbox-narrow');
  await group.getByRole('button', { name: 'Segunda tarea', exact: true }).click();
  const narrowDetails = await details.boundingBox();
  const narrowPage = await page.locator('.inbox-page').boundingBox();
  assert.equal(Math.round(narrowDetails.width), Math.round(narrowPage.width), 'A narrow window shows the details over the table.');
  await shot('inbox-narrow-details');
  await details.getByRole('button', { name: 'Close details' }).click();
  await details.waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 1280, height: 860 });

  // The tree says what a client holds.
  await page.getByRole('button', { name: 'Inbox of Harbor Studio' }).click();
  await page.getByRole('tab', { name: /^Inbox/, selected: true }).waitFor();
  await page.getByRole('button', { name: 'Tasks of Harbor Studio' }).click();
  await page.getByRole('tab', { name: 'Tasks', selected: true }).waitFor();

  // An area with no code: its own documents and links, and its checklist reaches the agent.
  await page.getByRole('button', { name: 'Areas of Harbor Studio' }).click();
  await page.getByRole('tab', { name: 'Areas', selected: true }).waitFor();
  await page.getByRole('button', { name: 'Slack' }).click();
  await page.getByLabel('Link address').fill('acme.slack.com');
  await page.getByRole('button', { name: 'Add link' }).click();
  await page.getByText('https://acme.slack.com').waitFor();
  await page.getByLabel('Link name').fill('Bad');
  await page.getByLabel('Link address').fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Add link' }).click();
  await page.getByText('Write a web address, starting with https://.').waitFor();
  await page.getByLabel('Link name').fill('');
  await page.getByLabel('Link address').fill('');
  await page.getByLabel('New area name').fill('Reportes de campo');
  await page.getByRole('button', { name: 'Add area' }).click();
  await page.getByRole('heading', { name: 'Reportes de campo' }).waitFor();
  await page.getByRole('button', { name: 'Instructions.md' }).click();
  await page.getByRole('button', { name: 'Edit in VS Code' }).click();
  await shot('project');
  const project = (await invoke('getSnapshot')).companies.find((item) => item.id === platform.id).subdomains.find((item) => item.name === 'Reportes de campo');
  assert.equal(project.folder, 'reportes-de-campo', 'An area folder is named after the area.');
  const projectFolder = join(home, 'companies', platform.id, 'areas', project.folder);
  await page.waitForTimeout(500);
  assert.ok(readFileSync(editorLog, 'utf8').includes(join(projectFolder, 'Instructions.md')), 'a project file opens in the editor');
  writeFileSync(join(projectFolder, 'Instructions.md'), '# Instrucciones\n\nLeer la guia antes de empezar.\n');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText('Leer la guia antes de empezar.').waitFor();

  await page.getByLabel('New document name').fill('Reporte 12');
  await page.getByRole('button', { name: 'New document' }).click();
  await page.getByRole('button', { name: 'Reporte 12.md' }).waitFor();
  await page.waitForTimeout(500);
  assert.ok(readFileSync(editorLog, 'utf8').includes(join(projectFolder, 'Reporte 12.md')), 'a new document opens in the editor');
  await page.getByRole('button', { name: 'Open area in VS Code' }).click();
  await page.getByText(/^Opened in VS Code/).waitFor();
  await until(() => readFileSync(editorLog, 'utf8').split('\n').includes(projectFolder), 'the area to open in the editor');
  await page.getByRole('tab', { name: /^Links/ }).click();
  await page.getByLabel('Link name').fill('Guia');
  await page.getByLabel('Link address').fill('guia.acme.dev');
  await page.getByRole('button', { name: 'Add link' }).click();
  await page.getByText('https://guia.acme.dev').waitFor();
  await page.getByRole('tab', { name: /^Tasks/ }).last().click();

  await page.getByRole('button', { name: 'New task' }).last().click();
  await page.getByLabel('Task title').or(page.getByLabel('Title')).first().fill('Revisar reporte 12');
  assert.equal(await page.getByRole("combobox", { name: /^Area/ }).inputValue(), project.id);
  await page.getByRole('button', { name: 'Create and start session' }).click();
  await page.getByTestId('terminal').waitFor();
  await until(() => existsSync(launchLog), 'the agent to start');
  const first = JSON.parse(readFileSync(launchLog, 'utf8').trim().split('\n')[0]);
  assert.equal(first.cwd, projectFolder, 'A client with no repositories works in the private folder of the area.');
  assert.ok(first.prompt.includes('Reportes de campo'), 'The agent knows the area.');
  assert.ok(first.prompt.includes('- Slack: https://acme.slack.com'), 'The agent knows the links.');
  assert.ok(first.prompt.includes('- Guia: https://guia.acme.dev'), 'The agent knows the links of the area.');
  await page.getByRole('tab', { name: 'Overview' }).click();
  await page.getByRole('region', { name: 'Where this task is' }).locator('[aria-current="step"]').getByText('In progress').waitFor();
  assert.equal(await page.getByText('Ready to merge').count(), 0, 'A task with no code has no merge step.');
  assert.equal(await page.getByRole('region', { name: 'Code' }).count(), 0);
  const checklist = page.getByRole('region', { name: 'Checklist' });
  await checklist.getByPlaceholder('Add a checklist item').fill('Enviar el reporte');
  await checklist.getByRole('button', { name: 'Add', exact: true }).click();
  await checklist.getByRole("checkbox", { name: "Enviar el reporte" }).click();
  await checklist.getByText('1 of 1 done').waitFor();
  await shot('task-without-code');
  await page.getByRole('button', { name: 'Stop session' }).click();
  await page.getByRole('button', { name: 'Resume session' }).waitFor();

  // Commit identity: nothing is written until the person accepts it.
  const before = readFileSync(gitConfig, 'utf8');
  await page.getByRole('button', { name: 'Settings for Acme' }).click();
  await page.getByRole('button', { name: 'Commit identity' }).click();
  await page.getByRole('heading', { name: 'Who commits for this client?' }).waitFor();
  await page.getByLabel('Name for commits').fill('Acme Dev');
  await page.getByLabel('Email for commits').fill('dev@acme.dev');
  await page.getByLabel('GitHub user').fill('dev-acme');
  assert.equal(await page.getByLabel('Folder of this client').inputValue(), '~/clients/acme/api/', 'It suggests a folder from the repositories.');
  await page.getByLabel('Folder of this client').fill('~/clients/acme');
  await page.getByRole('button', { name: 'Preview changes' }).click();
  const preview = page.getByLabel('Changes to your git config');
  await preview.getByText('[includeIf "gitdir:~/clients/acme/"]').waitFor();
  await shot('identity-preview');
  assert.equal(readFileSync(gitConfig, 'utf8'), before, 'A preview writes nothing.');
  await page.getByRole('button', { name: 'Apply to my git config' }).click();
  await page.getByRole('list', { name: 'Repositories and their identity' }).getByText('commits as dev@acme.dev').waitFor();
  await shot('identity-applied');
  assert.equal(git(repo, 'config', 'user.email'), 'dev@acme.dev');
  assert.equal(git(root, 'config', 'user.email'), 'me@personal.dev', 'Other folders keep their identity.');
  assert.equal(git(root, 'config', '--global', 'alias.st'), 'status', 'Other settings stay.');
  assert.ok(readFileSync(gitConfig, 'utf8').startsWith(before), 'The config only grows.');

  // Sessions of this client commit with its identity, in the task's own copy too.
  const task = await invoke('createTask', { companyId: acme.id, title: 'Con identidad', projectIds: ['api'] });
  await invoke('startSession', task.id);
  await until(() => readFileSync(launchLog, 'utf8').trim().split('\n').length === 2, 'the second agent');
  const second = JSON.parse(readFileSync(launchLog, 'utf8').trim().split('\n')[1]);
  assert.equal(second.author, 'dev@acme.dev');
  assert.ok(second.prompt.includes('Acme Dev <dev@acme.dev>'));
  assert.equal(git(second.cwd, 'config', 'user.email'), 'dev@acme.dev', 'The task copy uses the rule of the folder.');

  // Nothing of this client reached the repository.
  assert.equal(git(repo, 'status', '--porcelain'), '');
  assert.deepEqual(failures, []);
  console.log('clients test passed');
} finally {
  await app.close().catch(() => {});
  rmSync(root, { recursive: true, force: true });
}
