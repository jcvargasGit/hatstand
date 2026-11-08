import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hiddenWindowEnv } from './hidden-window.mjs';
import { testKeychainEnv } from './platform.mjs';

const appRoot = new URL('../..', import.meta.url).pathname;
const { _electron: electron } = createRequire(`${appRoot}package.json`)('playwright-core');
const shots = process.env.HATSTAND_SHOTS;
const root = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-workspaces-')));
const home = join(root, 'home');
const bin = join(root, 'bin');
const wheelLog = join(root, 'wheel.log');
const argsLog = join(root, 'args.log');
const mono = join(root, 'code', 'mono');
const specs = join(root, 'specs');

for (const folder of ['apps/uploads', 'apps/portal', 'libs/media']) mkdirSync(join(mono, folder), { recursive: true });
writeFileSync(join(mono, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n  - 'libs/*'\n");
execFileSync('git', ['init', '-q'], { cwd: mono });
for (const folder of ['backlog/pending', 'backlog/done', 'docs/adr', 'PR-reviews/api']) mkdirSync(join(specs, folder), { recursive: true });
execFileSync('git', ['init', '-q'], { cwd: specs });

mkdirSync(bin);
writeFileSync(
  join(bin, 'claude'),
  `#!${process.execPath}
const { appendFileSync, writeFileSync } = require('node:fs');
if (process.argv.includes('--version')) { console.log('1.0.0'); process.exit(0); }
if (process.argv.includes('auth')) { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
writeFileSync(${JSON.stringify(argsLog)}, process.argv.slice(2).join('\\n'));
process.stdout.write('\\x1b[?1049h\\x1b[?1003h\\x1b[?1006hfake agent with the mouse\\r\\n');
process.stdin.setRawMode(true);
process.stdin.on('data', (data) => {
  const text = data.toString();
  const wheel = text.match(/\\x1b\\[<6[45];/g);
  if (wheel) appendFileSync(${JSON.stringify(wheelLog)}, 'x'.repeat(wheel.length));
  else process.stdout.write(text);
});
`,
);
chmodSync(join(bin, 'claude'), 0o755);

const app = await electron.launch({
  args: [appRoot, '--use-mock-keychain'],
  cwd: appRoot,
  env: { ...process.env, ...hiddenWindowEnv, ...testKeychainEnv, HATSTAND_HOME: home, HATSTAND_PATH: `${bin}:/usr/bin:/bin`, HATSTAND_NODE: process.execPath, HATSTAND_SKIP_QUIT_PROMPT: '1' },
});

try {
  const page = await app.firstWindow();
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  const invoke = (method, ...args) => page.evaluate(([name, input]) => window.hatstand.invoke(name, ...input), [method, args]);
  const shot = async (name) => {
    if (shots) await page.screenshot({ path: join(shots, `w-${name}.png`) });
  };

  const company = await invoke('createCompany', 'Northwind', '#5BB8A6');
  await invoke('createCompany', 'Other Client', '#8FA6F0');
  await invoke('saveCompany', { ...company, rootDir: mono, projects: [{ id: 'mono', name: 'mono', path: mono }] });
  await page.reload();
  await page.getByRole('button', { name: /^Settings for Northwind/ }).click();
  const steps = page.getByRole('navigation', { name: 'Setup steps' });

  await steps.getByRole('button', { name: /Areas/ }).click();
  await page.getByText('This looks like a monorepo (pnpm workspace), with 3 folders.').waitFor();
  await shot('monorepo-detected');
  await page.getByRole('button', { name: 'Split by folder' }).click();
  await page.getByLabel('Area for apps/uploads').selectOption({ label: 'New: uploads' });
  await page.getByLabel('Area for apps/uploads').locator('option:checked', { hasText: 'uploads' }).waitFor({ state: 'attached' });
  await page.getByLabel('Area for libs/media').selectOption({ label: 'uploads' });
  await shot('monorepo-split');

  await steps.getByRole('button', { name: /Planning/ }).click();
  await page.getByLabel('Planning folder, full path').fill(specs);
  await page.getByRole('button', { name: 'Add path' }).click();
  await page.locator('input[value="backlog/pending"]').waitFor();
  await page.locator('input[value="docs/adr"]').waitFor();
  await page.locator('input[value="PR-reviews"]').waitFor();
  await shot('planning');

  await steps.getByRole('button', { name: /Agent/ }).click();
  await page.getByText('Add an account only for this client').click();
  await page.getByLabel('Name', { exact: true }).fill('Northwind Claude');
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByLabel('Default agent').locator('option:checked', { hasText: 'Northwind Claude' }).waitFor({ state: 'attached' });
  await shot('client-account');
  const { companies, accounts } = await invoke('getSnapshot');
  const added = accounts.accounts.find((account) => account.name === 'Northwind Claude');
  assert.equal(added.companyId, 'northwind');
  assert.equal(companies.find((item) => item.id === 'northwind').defaultAccountId, added.id, 'it becomes the default of this client only');
  assert.equal(companies.find((item) => item.id === 'other-client').defaultAccountId, undefined);

  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByRole('main').locator('label', { hasText: /^Client/ }).locator('select').selectOption({ label: 'Northwind' });
  await page.getByLabel('Task title').fill('Retry failed uploads');
  await page.getByRole('combobox', { name: /^Area/ }).selectOption({ label: 'uploads' });
  await page.getByText('The agent focuses on apps/uploads, libs/media.').waitFor();
  await shot('new-task');
  await page.getByRole('button', { name: 'Create and start session' }).click();
  await page.getByTestId('terminal').getByText('fake agent with the mouse').waitFor({ timeout: 15000 });
  await page.getByTestId('terminal').getByText('Focus on mono/apps/uploads, mono/libs/media').waitFor({ timeout: 10000 });

  const after = await invoke('getSnapshot');
  const session = after.sessions[0];
  assert.equal(session.accountId, added.id);
  assert.equal(session.cwd, mono, 'the session opens at the top of the monorepo');
  const prompt = readFileSync(join(home, 'run', `${session.id}.prompt.md`), 'utf8');
  assert.ok(prompt.includes(join(mono, 'apps/uploads')), 'the prompt lists the subdomain folders');
  assert.ok(prompt.includes(`Plans, tickets, specs and decisions for this client live in ${specs}`));
  assert.ok(prompt.includes('- Tickets: backlog/pending'));
  assert.ok(prompt.includes('Do not commit, push or open a pull request in this repository unless the person asks.'));
  assert.ok(readFileSync(argsLog, 'utf8').split('\n').includes(specs), 'the planning repository is in reach');

  const box = await page.getByTestId('terminal').boundingBox();
  await page.mouse.move(box.x + 200, box.y + 200);
  for (let tick = 0; tick < 100; tick += 1) {
    await page.mouse.wheel(0, 8);
    await page.waitForTimeout(8);
  }
  await page.waitForTimeout(400);
  const events = readFileSync(wheelLog, 'utf8').length;
  console.log(`wheel events for 800px of trackpad: ${events}`);
  assert.ok(events >= 40, `the agent should get about one event per line, got ${events}`);

  await invoke('stopSession', session.id);
  assert.deepEqual(failures, []);
  console.log('workspaces test passed');
} finally {
  await app.close();
  rmSync(root, { recursive: true, force: true });
}
