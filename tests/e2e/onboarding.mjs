// Walks a client from scratch against a local fake GitLab that serves real git
// repositories, with throwaway data and a fake `claude`. It uses no real account.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { chmodSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, normalize, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';
import { hiddenWindowEnv } from './hidden-window.mjs';
import { testKeychainEnv } from './platform.mjs';

const appRoot = resolve(import.meta.dirname, '../..');
const shots = process.env.HATSTAND_SHOTS;
const root = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-onboarding-')));
const home = join(root, 'home');
const bin = join(root, 'bin');
const remotes = join(root, 'remotes');
const signedInFlag = join(root, 'signed-in');
const record = join(root, 'claude-launch.json');
const GOOD_TOKEN = 'zenith-gitlab-token-value';

mkdirSync(bin);
writeFileSync(
  join(bin, 'claude'),
  `#!${process.execPath}
const fs = require('node:fs');
const [first, second] = process.argv.slice(2);
if (first === 'auth' && second === 'status') {
  const loggedIn = fs.existsSync(${JSON.stringify(signedInFlag)});
  console.log(JSON.stringify({ loggedIn, email: loggedIn ? 'dev@zenith.test' : null, subscriptionType: loggedIn ? 'max' : null }));
  process.exit(0);
}
if (first === 'auth' && second === 'login') {
  console.log('Opening your browser');
  setTimeout(() => { fs.writeFileSync(${JSON.stringify(signedInFlag)}, 'yes'); process.exit(0); }, 300);
} else {
  fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args: process.argv.slice(2), env: process.env, cwd: process.cwd() }));
  console.log('fake claude is ready');
  fs.writeFileSync(process.env.HATSTAND_STATUS_FILE, 'needs-input');
  process.stdin.setRawMode(true);
  process.stdin.on('data', (data) => fs.appendFileSync(${JSON.stringify(record)} + '.input', data));
}
`,
);
chmodSync(join(bin, 'claude'), 0o755);
const editorLog = join(root, 'editor.log');
writeFileSync(join(bin, 'code'), `#!/bin/sh\nprintf '%s\\n' "$@" >> "${editorLog}"\n`, { mode: 0o755 });

const makeRemote = (relativePath) => {
  const seed = join(root, 'seed', relativePath);
  const bare = join(remotes, `${relativePath}.git`);
  mkdirSync(seed, { recursive: true });
  mkdirSync(join(bare, '..'), { recursive: true });
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.dev', ...args], { cwd: seed });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(seed, 'README.md'), `${relativePath}\n`);
  git('add', '.');
  git('commit', '-qm', 'first');
  execFileSync('git', ['clone', '-q', '--bare', seed, bare]);
  execFileSync('git', ['update-server-info'], { cwd: bare });
};
makeRemote('zenith/gallery-api');
makeRemote('zenith/web/portal');

let origin = '';
const server = createServer((request, response) => {
  const url = new URL(request.url, origin);
  const send = (status, body, headers = {}) => {
    response.writeHead(status, { 'content-type': 'application/json', ...headers });
    response.end(JSON.stringify(body));
  };
  if (url.pathname.startsWith('/api/v4/')) {
    if (request.headers['private-token'] !== GOOD_TOKEN) return send(401, {});
    if (url.pathname === '/api/v4/groups/zenith') return send(200, { id: 1 });
    if (url.pathname === '/api/v4/groups/zenith/projects') {
      return send(200, [
        { path_with_namespace: 'zenith/gallery-api', http_url_to_repo: `${origin}/zenith/gallery-api.git`, description: 'Gallery' },
        { path_with_namespace: 'zenith/web/portal', http_url_to_repo: `${origin}/zenith/web/portal.git`, description: '' },
        { path_with_namespace: 'zenith/retired', http_url_to_repo: `${origin}/zenith/retired.git`, archived: true },
      ]);
    }
    return send(404, {});
  }
  const expected = `Basic ${Buffer.from(`oauth2:${GOOD_TOKEN}`).toString('base64')}`;
  if (request.headers.authorization !== expected) {
    return send(401, {}, { 'www-authenticate': 'Basic realm="git"' });
  }
  const file = join(remotes, normalize(url.pathname));
  if (!file.startsWith(remotes) || !existsSync(file) || statSync(file).isDirectory()) return send(404, {});
  response.writeHead(200);
  createReadStream(file).pipe(response);
});
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
origin = `http://127.0.0.1:${server.address().port}`;

const shot = async (page, name) => {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
};

const gitConfig = join(root, 'gitconfig');
writeFileSync(gitConfig, '[user]\n  name = Test Person\n  email = person@zenith.test\n');

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
    GIT_CONFIG_GLOBAL: gitConfig,
  },
});

const failures = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => failures.push(`page error: ${error.message}`));
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole('heading', { name: 'Add your first client' }).waitFor();
  await page.getByLabel('Client or project name').fill('Zenith Labs');
  await shot(page, '6a-new-client');
  await page.getByRole('main').getByRole('button', { name: 'Add client' }).click();

  await page.getByRole('heading', { name: 'Which agent?' }).waitFor();
  await page.getByText('is not signed in').waitFor();
  await shot(page, '6b-agent-signed-out');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('Signed in as dev@zenith.test, max plan').waitFor();
  await shot(page, '6c-agent-ready');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByRole('heading', { name: 'Where is the code?' }).waitFor();
  await page.getByLabel('Where is the code hosted?').selectOption('gitlab');
  await page.getByLabel(/GitLab address/).fill(origin);
  await page.getByLabel('Group or user').fill('zenith');
  await page.getByLabel('Access token').fill('wrong-token');
  await shot(page, '6d-connect');
  await page.getByRole('button', { name: 'Connect and list repositories' }).click();
  await page.getByText('GitLab rejected this token').waitFor();
  await page.getByLabel('Access token').fill(GOOD_TOKEN);
  await page.getByRole('button', { name: 'Connect and list repositories' }).click();

  await page.getByText('Found 2 repositories in zenith').waitFor();
  assert.equal(await page.getByText('retired').count(), 0, 'archived repositories stay hidden');
  const target = join(root, 'code', 'zenith');
  await page.getByLabel('Download to').fill(target);
  await shot(page, '6e-select-repos');
  await page.getByRole('button', { name: 'Download 2 repositories' }).click();
  await page.getByText('Ready: 2 repositories.').waitFor();
  await page.getByRole('cell', { name: 'web/portal' }).waitFor();
  await shot(page, '6f-downloaded');

  const gallery = join(target, 'gallery-api');
  assert.equal(readFileSync(join(gallery, 'README.md'), 'utf8'), 'zenith/gallery-api\n');
  assert.ok(existsSync(join(target, 'web', 'portal', 'README.md')));
  const companyDir = join(home, 'companies', 'zenith-labs');
  for (const file of [join(gallery, '.git', 'config'), join(companyDir, 'company.yaml'), join(companyDir, 'secrets.enc')]) {
    assert.ok(!readFileSync(file).includes(GOOD_TOKEN), `${file} must not contain the token in the clear`);
  }

  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Areas of this client' }).waitFor();
  await page.getByLabel('New area name').fill('Gallery');
  await page.getByRole('button', { name: 'Add area' }).click();
  await page.locator('.client-project-open', { hasText: 'Gallery' }).waitFor();
  await page.getByRole('button', { name: 'Suggest from repository names' }).click();
  await page.getByRole('checkbox', { name: 'Use Gallery' }).waitFor();
  await shot(page, '7a-suggestions');
  await page.getByRole('button', { name: 'Apply 1 area' }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Area for gallery-api"]')?.selectedOptions[0]?.text === 'Gallery');
  await shot(page, '6g-subdomains');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByRole('heading', { name: 'Client planning' }).waitFor();
  const planningRepo = join(root, 'zenith-plans');
  const newFolder = page.getByLabel('Folder for the new planning repository');
  await page.waitForFunction(() => document.querySelector('[aria-label="Folder for the new planning repository"]')?.value.endsWith('-planning'));
  await shot(page, '6h-planning-offer');
  await newFolder.fill(planningRepo);
  await page.getByRole('button', { name: 'Create repository' }).click();
  await page.getByRole('heading', { name: 'Where each thing goes' }).waitFor();
  await page.getByLabel('Folder of place 1').waitFor();
  assert.equal(await page.getByLabel('Folder of place 1').inputValue(), 'decisions');
  assert.equal(await page.getByLabel('Folder of place 2').inputValue(), 'specs');
  const inPlanningRepo = (...args) => execFileSync('git', args, { cwd: planningRepo, encoding: 'utf8' }).trim();
  assert.equal(inPlanningRepo('rev-list', '--count', 'HEAD'), '1');
  assert.equal(inPlanningRepo('log', '-1', '--format=%ae'), 'person@zenith.test');
  assert.equal(inPlanningRepo('remote'), '');
  const planningFacts = await page.evaluate(async () => {
    const { companies } = await window.hatstand.invoke('getSnapshot');
    const client = companies.find((item) => item.id === 'zenith-labs');
    const files = await window.hatstand.invoke('listClientFiles', 'zenith-labs');
    return { planning: client.planning.path, repositories: client.projects.map((repo) => repo.path), documents: files.filter((file) => file.scope === 'planning').map((file) => file.name) };
  });
  assert.equal(planningFacts.planning, planningRepo);
  assert.ok(!planningFacts.repositories.includes(planningRepo), 'it is not offered as a repository for tasks');
  assert.deepEqual(planningFacts.documents.sort(), ['README.md', 'templates/decision.md', 'templates/spec.md']);
  await shot(page, '6h-planning-created');
  await page.getByRole('button', { name: 'Go back to the default folder' }).click();
  await page.getByRole('button', { name: 'Use the default folder' }).click();
  await newFolder.waitFor();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'LLM config', exact: true }).waitFor();
  assert.ok(existsSync(join(companyDir, 'plugin', '.claude-plugin', 'plugin.json')));
  await page.getByText('Hatstand created this starter file').waitFor();
  assert.ok(existsSync(join(companyDir, 'instructions.md')));
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByRole('heading', { name: 'Client knowledge' }).waitFor();
  assert.ok(existsSync(join(companyDir, 'knowledge', 'README.md')));
  await shot(page, '6h-knowledge');
  await page.getByRole('button', { name: 'README.md' }).click();
  assert.equal(await page.locator('.client-files textarea').count(), 0, 'files are edited in the editor');
  await page.getByRole('button', { name: 'Edit in VS Code' }).click();
  await page.waitForTimeout(500);
  assert.ok(readFileSync(editorLog, 'utf8').includes(join(companyDir, 'knowledge', 'README.md')));
  writeFileSync(join(companyDir, 'knowledge', 'README.md'), '# Knowledge map\n\nStart with gallery.\n');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('heading', { name: 'Knowledge map' }).waitFor();
  await shot(page, '8c-file-editor');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByRole('heading', { name: 'Keys and tools' }).waitFor();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Links of this client' }).waitFor();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('heading', { name: 'Who commits for this client?' }).waitFor();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  const portalHook = join(target, 'web', 'portal', '.git', 'hooks', 'pre-commit');
  writeFileSync(portalHook, '#!/bin/sh\nexit 0\n');
  chmodSync(portalHook, 0o755);
  await page.getByRole('button', { name: 'Protect repositories' }).click();
  await page.getByText('Protected 1 repository').waitFor();
  await page.getByText('1 of 2 repositories protected.').waitFor();
  await page.getByText('This repository already has a pre-commit hook.').waitFor();
  await shot(page, '7b-protection-list');
  await page.getByRole('button', { name: 'Protect and keep its hook' }).click();
  await page.getByText('2 of 2 repositories protected.').waitFor();
  assert.equal(readFileSync(join(target, 'web', 'portal', '.git', 'hooks', 'before-hatstand', 'pre-commit'), 'utf8'), '#!/bin/sh\nexit 0\n');
  await shot(page, '7c-protection-done');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByRole('heading', { name: 'Task guides' }).waitFor();
  await page.getByRole('button', { name: 'Customize Investigate a bug' }).click();
  await page.getByText('Customized for this client').waitFor();
  const guideFile = (await page.evaluate(() => window.hatstand.invoke('listPlaybooks', 'zenith-labs'))).playbooks.find((guide) => guide.file)?.file;
  await page.waitForTimeout(500);
  assert.ok(readFileSync(editorLog, 'utf8').includes(guideFile), 'a customized guide opens in the editor');
  const guideText = readFileSync(guideFile, 'utf8');
  const comeBack = () => page.evaluate(() => window.dispatchEvent(new Event('focus')));
  writeFileSync(guideFile, 'name: Broken\nsteps: []\n');
  await comeBack();
  await page.getByText('A guide needs at least one step').waitFor();
  writeFileSync(guideFile, guideText.replace('Investigate a bug', 'Zenith bugs'));
  await comeBack();
  await page.locator('.guide-list').getByText('Zenith bugs').waitFor();

  const editedLine = 'A knowledge line edited in the editor, long enough for commit protection to notice.';
  const editedHash = createHash('sha256').update(editedLine).digest('hex');
  const protectedLines = () => JSON.parse(readFileSync(join(home, 'guard', 'zenith-labs.json'), 'utf8')).lineHashes;
  writeFileSync(join(companyDir, 'knowledge', 'edited.md'), `${editedLine}\n`);
  assert.equal(protectedLines().includes(editedHash), false);
  await app.evaluate(({ app }) => app.emit('browser-window-focus'));
  assert.ok(protectedLines().includes(editedHash), 'coming back to the app updates commit protection');
  await shot(page, '7d-guides');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByRole('heading', { name: 'Review' }).waitFor();
  const setup = page.getByRole('region', { name: 'Client setup' });
  await setup.getByText('83%').waitFor();
  writeFileSync(join(companyDir, 'instructions.md'), 'Always run the gallery tests before finishing.\n');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await setup.getByText('83%').waitFor();
  await page.evaluate(async () => {
    const { companies } = await window.hatstand.invoke('getSnapshot');
    const company = companies.find((item) => item.name === 'Zenith Labs');
    await window.hatstand.invoke('saveCompany', { ...company, gitIdentity: { name: 'Dev', email: 'dev@zenith.example', folder: '~/zenith/', appliedAt: 'now' } });
    window.dispatchEvent(new Event('focus'));
  });
  await setup.getByText('100%').waitFor();
  await page.getByRole('heading', { name: 'Review' }).waitFor();
  await shot(page, '6i-review');
  await page.getByRole('button', { name: 'Go to tasks' }).click();

  await page.getByRole('main').getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByLabel('Task title').fill('Check the gallery export');
  await page.getByRole('checkbox', { name: 'gallery-api' }).check();
  await page.getByRole('checkbox', { name: 'web/portal' }).check();
  await shot(page, '8a-new-task');
  await page.getByRole('button', { name: 'Create and start session' }).click();
  await page.getByRole('heading', { name: 'Check the gallery export' }).waitFor();
  await page.getByTestId('terminal').waitFor();
  for (let tries = 0; tries < 50 && !existsSync(record); tries += 1) await page.waitForTimeout(100);

  const launch = JSON.parse(readFileSync(record, 'utf8'));
  assert.equal(launch.cwd, target, 'the session reads the client folder until it needs a copy');
  assert.ok(existsSync(join(launch.cwd, 'gallery-api', '.git')), 'the session opens in the folder with every repository');
  assert.ok(existsSync(join(launch.cwd, 'web', 'portal', '.git')), 'the session opens in the folder with every repository');
  await page.getByRole('region', { name: 'Task' }).getByText('2 repositories').waitFor();
  await page.waitForTimeout(1200);
  await shot(page, '8b-task-terminal');
  assert.equal(launch.env.GITLAB_TOKEN, GOOD_TOKEN);
  assert.equal(launch.env.GIT_CONFIG_KEY_1, `credential.${origin}.helper`);
  assert.ok(!launch.env.GIT_CONFIG_VALUE_1.includes(GOOD_TOKEN), 'the helper reads the token from the environment');
  const prompt = readFileSync(launch.args[launch.args.indexOf('--append-system-prompt-file') + 1], 'utf8');
  assert.ok(prompt.includes('Always run the gallery tests'), 'edited instructions reach the agent');
  await promisify(execFile)('git', ['fetch', '-q', 'origin'], { cwd: gallery, env: launch.env, timeout: 30_000 });

  await page.getByRole('button', { name: 'Stop session' }).click();
  await page.getByRole('button', { name: 'Resume session' }).waitFor({ timeout: 10000 });

  const panel = page.getByRole('region', { name: 'Task' });
  await panel.getByRole('heading', { name: 'Check the gallery export' }).hover();
  await panel.getByRole('button', { name: 'Rename task' }).click();
  await panel.getByLabel('Task name').fill('Check the gallery export again');
  await page.keyboard.press('Enter');
  await panel.getByRole('heading', { name: 'Check the gallery export again' }).waitFor();
  const client = page.getByRole('region', { name: 'Zenith Labs tasks' });
  await panel.getByRole('button', { name: 'Mark done' }).click();
  await panel.getByRole('alert').getByText('This task has not reached Merged.').waitFor();
  await panel.getByRole('button', { name: 'Mark done anyway' }).click();
  await panel.getByText('Done', { exact: true }).waitFor();
  await client.getByRole('button', { name: 'Done and archived (1)' }).click();
  await shot(page, '8d-done-group');

  // Closed work is listed by the period this client chose.
  await page.getByRole('button', { name: 'Documents for Zenith Labs' }).click();
  await page.getByRole('tab', { name: 'Closed tasks' }).click();
  await page.getByRole('heading', { name: 'Closed tasks' }).waitFor();
  await page.getByLabel('Every').fill('3');
  await page.getByLabel('Unit').selectOption('days');
  await page.getByRole('button', { name: 'Save period' }).click();
  await page.getByText('Every 3 days for this client.').waitFor();
  await shot(page, '8d-closed-tab');

  // A long title and description are cut with an ellipsis, so the page never scrolls sideways.
  const changeGalleryTask = (title, patch) =>
    page.evaluate(async ([current, change]) => {
      const { tasks } = await window.hatstand.invoke('getSnapshot');
      await window.hatstand.invoke('updateTask', tasks.find((item) => item.title === current).id, change);
      window.dispatchEvent(new Event('focus'));
    }, [title, patch]);
  const longTitle = 'Check the gallery export again '.repeat(8).trim();
  const longSummary = 'The export drops rows when a photo has no caption '.repeat(6).trim();
  await changeGalleryTask('Check the gallery export again', { title: longTitle, description: `## ${longSummary}\n\nMore details.` });
  const closedTitle = page.locator('.closed-page').getByRole('button', { name: longTitle });
  await closedTitle.waitFor();
  assert.equal(await closedTitle.getAttribute('title'), longTitle, 'hovering shows the whole title');
  await page.locator('.closed-page').getByText(longSummary).waitFor();
  for (const { width, guideShown } of [{ width: 1440, guideShown: true }, { width: 1200, guideShown: true }, { width: 1000, guideShown: false }, { width: 760, guideShown: false }]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => {
      const closedPage = document.querySelector('.closed-page');
      const title = closedPage.querySelector('.closed-task-title');
      const summary = closedPage.querySelector('.closed-task-summary');
      const date = closedPage.querySelector('.closed-date');
      const tabs = document.querySelector('.client-tabs .task-tabs');
      const lastTab = [...tabs.children].at(-1);
      return {
        tabsOverflow: lastTab.getBoundingClientRect().right - tabs.getBoundingClientRect().right,
        pageOverflow: closedPage.scrollWidth - closedPage.clientWidth,
        titleIsCut: title.scrollWidth > title.clientWidth,
        titleWidth: title.clientWidth,
        titleLineHeight: title.getBoundingClientRect().height,
        summaryIsCut: summary.scrollWidth > summary.clientWidth,
        summaryLineHeight: summary.getBoundingClientRect().height,
        dateIsCut: date.scrollWidth > date.clientWidth,
        guideShown: getComputedStyle(closedPage.querySelector('td.closed-col-guide')).display !== 'none',
      };
    });
    console.log(`Closed at ${width}px: title ${layout.titleWidth}px wide, guide column ${layout.guideShown ? 'shown' : 'hidden'}`);
    assert.equal(layout.pageOverflow, 0, `Closed scrolls sideways at ${width}px`);
    assert.ok(layout.tabsOverflow <= 0, `the client tabs fit at ${width}px, but go ${layout.tabsOverflow}px past`);
    assert.ok(layout.titleIsCut, `the long title is cut at ${width}px`);
    assert.ok(layout.titleWidth >= 200, `the long title can be read at ${width}px, but is ${layout.titleWidth}px wide`);
    assert.ok(layout.titleLineHeight < 30, `the long title stays on one line at ${width}px`);
    assert.ok(layout.summaryIsCut, `the long description is cut at ${width}px`);
    assert.ok(layout.summaryLineHeight < 30, `the long description stays on one line at ${width}px`);
    assert.ok(!layout.dateIsCut, `the date stays whole at ${width}px`);
    assert.equal(layout.guideShown, guideShown, `the guide column at ${width}px`);
    await shot(page, `8d-closed-long-title-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await changeGalleryTask(longTitle, { title: 'Check the gallery export again', description: '' });
  await page.locator('.closed-page').getByRole('button', { name: longTitle }).waitFor({ state: 'detached' });

  await page.getByRole('button', { name: 'Check the gallery export again' }).last().click();
  await panel.getByRole('button', { name: 'Reopen' }).waitFor();
  await panel.getByRole('button', { name: 'Reopen' }).click();
  await panel.getByRole('button', { name: 'Archive', exact: true }).click();
  await panel.locator('.panel-state').getByText('Archived', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Restore' }).click();
  await panel.getByRole('button', { name: 'Archive', exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Delete', exact: true }).click();
  await shot(page, '8e-delete-confirm');
  await panel.getByRole('button', { name: 'Delete task' }).click();
  await page.getByRole('heading', { name: 'Zenith Labs' }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Check the gallery export/ }).count(), 0, 'a deleted task is gone');

  const typed = async (text) => {
    for (let tries = 0; tries < 100; tries += 1) {
      const input = readFileSync(`${record}.input`, 'utf8');
      if (input.includes(text)) return input;
      await page.waitForTimeout(100);
    }
    throw new Error(`The terminal never received: ${text}`);
  };
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByLabel('Task title').fill('Review the gallery PR');
  await page.getByLabel('Guide').selectOption({ label: 'Review a pull request' });
  await page.getByRole('button', { name: 'Create and start session' }).click();
  await page.getByRole('heading', { name: 'Review the gallery PR' }).waitFor();
  assert.ok(!(await typed('Step 1 of 4, Read the PR')).includes('\r'), 'a step is written, never sent');

  const guideBar = page.getByRole('region', { name: 'Guide' });
  await guideBar.getByText('waiting for you at its prompt').waitFor();
  assert.ok(await guideBar.getByRole('button', { name: 'Send to agent' }).isDisabled(), 'no pressing Enter on a question');
  const guideLaunch = JSON.parse(readFileSync(record, 'utf8'));
  writeFileSync(guideLaunch.env.HATSTAND_STATUS_FILE, 'idle');
  await guideBar.getByRole('button', { name: 'Send to agent' }).click();
  await typed('\r');
  const nextStep = guideBar.getByRole('button', { name: 'Next step' });
  await nextStep.waitFor();
  assert.ok(await nextStep.isDisabled(), 'the end of a turn does not finish a step');
  execFileSync('hatstand-step-done', ['1'], { env: guideLaunch.env });
  await guideBar.getByText('The agent finished this step').waitFor();
  await nextStep.click();
  const afterSend = (await typed('Step 2 of 4, Draft comments')).split('Step 2 of 4')[1];
  assert.ok(!afterSend.includes('\r'), 'the next step is written, not sent');
  await guideBar.getByRole('button', { name: 'Send to agent' }).waitFor();
  const guideTree = page.getByRole('region', { name: 'Zenith Labs tasks' });
  await guideTree.getByText('PR review, step 2 of 4').waitFor();
  await guideTree.getByTitle('Review a pull request').waitFor();

  writeFileSync(
    guideLaunch.env.HATSTAND_ACTIVITY_FILE,
    [
      { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'Explore', description: 'Read the changed files' } },
      { hook_event_name: 'SubagentStart', agent_id: 'one', agent_type: 'Explore' },
    ].map((event) => JSON.stringify(event)).join('\n') + '\n',
  );
  const subagents = page.getByRole('region', { name: 'Subagents' });
  await subagents.getByRole('button', { name: '1 subagent, 1 running' }).click({ timeout: 10000 });
  await subagents.getByText('Read the changed files').waitFor();
  await shot(page, '8h-guide-subagents');

  await page.getByRole('button', { name: 'Stop session' }).click();
  await page.getByRole('button', { name: 'Resume session' }).waitFor({ timeout: 10000 });
  await subagents.getByLabel('Stopped with the session').waitFor({ timeout: 10000 });
  await guideBar.getByRole('button', { name: /Post comments/ }).click();
  await guideBar.getByText('Read the prompt and the draft').waitFor();
  await page.getByRole('button', { name: 'Resume session' }).click();
  await typed('Step 3 of 4, Post comments');
  await subagents.getByLabel('Stopped with the session').waitFor({ timeout: 10000 });
  await shot(page, '8i-guide-approval');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  await shot(page, '8j-guide-dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: 'Stop session' }).click();
  await page.getByRole('button', { name: 'Resume session' }).waitFor({ timeout: 10000 });

  await page.getByRole('button', { name: 'Hide sidebar' }).click();
  await page.getByRole('button', { name: 'Show sidebar' }).waitFor();
  await shot(page, '8f-sidebar-collapsed');
  await page.getByRole('button', { name: 'Show sidebar' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('heading', { name: 'Add an account' }).waitFor();
  await shot(page, '8g-settings');

  await page.getByRole('button', { name: 'Archive Zenith Labs' }).click();
  await page.getByRole('heading', { name: 'Archived clients' }).waitFor();
  assert.equal(await page.getByRole('region', { name: 'Zenith Labs tasks' }).count(), 0, 'an archived client leaves the task tree');
  await page.getByRole('button', { name: 'Restore' }).click();
  await page.getByRole('region', { name: 'Zenith Labs tasks' }).waitFor();
  await page.getByRole('button', { name: 'Archive Zenith Labs' }).click();
  await page.getByRole('region', { name: 'Archived clients' }).getByRole('button', { name: 'Remove', exact: true }).click();
  await shot(page, '8k-remove-client');
  await page.getByLabel('Type Zenith Labs to confirm').fill('Zenith Labs');
  await page.getByRole('button', { name: 'Remove client' }).click();
  await page.getByText(/^Removed Zenith Labs\. Its files are in /).waitFor();
  assert.ok(!existsSync(companyDir), 'the client left Hatstand');
  const [removed] = readdirSync(join(companyDir, '..', '..', 'removed'));
  const keptFolder = join(companyDir, '..', '..', 'removed', removed);
  assert.ok(existsSync(join(keptFolder, 'instructions.md')), 'files are kept');
  assert.ok(!existsSync(join(keptFolder, 'secrets.enc')), 'keys are not kept');
  assert.equal(readFileSync(join(target, 'web', 'portal', '.git', 'hooks', 'pre-commit'), 'utf8'), '#!/bin/sh\nexit 0\n', 'the previous hook is back');
  assert.ok(existsSync(join(target, 'web', 'portal', '.git')), 'repositories stay');
  assert.deepEqual(failures, []);
  console.log('onboarding test passed');
} catch (error) {
  console.error(failures);
  throw error;
} finally {
  await app.close();
  server.close();
  rmSync(root, { recursive: true, force: true });
}
