import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hiddenWindowEnv } from './hidden-window.mjs';
import { shortcut, testKeychainEnv } from './platform.mjs';

const appRoot = new URL('../..', import.meta.url).pathname;
const shots = process.env.HATSTAND_SHOTS;
const { _electron: electron } = createRequire(`${appRoot}package.json`)('playwright-core');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-prod-')));
const home = join(root, 'home');
const repo = join(root, 'code', 'demo');
const specs = join(root, 'code', 'specs');
mkdirSync(repo, { recursive: true });
mkdirSync(join(specs, 'specs'), { recursive: true });
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
for (const dir of [repo, specs]) {
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'fake@example.invalid');
  git(dir, 'config', 'user.name', 'Fake');
}
writeFileSync(join(repo, 'app.txt'), 'one\ntwo\n');
git(repo, 'add', '.');
git(repo, 'commit', '-qm', 'start');
writeFileSync(join(repo, 'app.txt'), 'one\nthree\n');
writeFileSync(join(repo, 'new.txt'), 'brand new\n');
writeFileSync(join(specs, 'specs', 'exportacion.md'), '# Exportación\n\nEl reporte de revisión debe salir en CSV.\n');

const ok = (label, value) => assert.ok(value, label);
const shot = async (name) => {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
};

const editorBin = join(home, 'fake-bin');
mkdirSync(editorBin, { recursive: true });
const editorLog = join(editorBin, 'editor.log');
writeFileSync(join(editorBin, 'code'), `#!/bin/sh\nprintf '%s\\n' "$@" >> "${editorLog}"\n`, { mode: 0o755 });
const launch = () => electron.launch({ args: [appRoot, '--use-mock-keychain'], cwd: appRoot, env: { ...process.env, ...hiddenWindowEnv, ...testKeychainEnv, HATSTAND_HOME: home, HATSTAND_PATH: `${editorBin}:${process.env.PATH}`, HATSTAND_SKIP_QUIT_PROMPT: '1' } });
let app = await launch();
let page = await app.firstWindow();
await page.setViewportSize({ width: 1280, height: 900 });
let invoke = (method, ...args) => page.evaluate(([name, input]) => window.hatstand.invoke(name, ...input), [method, args]);
const clientOrder = async () => (await page.locator('.tree-client .nav-name').allInnerTexts()).filter((name) => /Labs|Retail|Logistics/.test(name));

try {
  const labs = await invoke('createCompany', 'Alpha Labs', '#5BB8A6');
  const retail = await invoke('createCompany', 'Beta Retail', '#E0A04E');
  await invoke('createCompany', 'Gamma Logistics', '#8C9AF2');
  await invoke('saveCompany', { ...labs, projects: [{ id: 'demo', name: 'demo', path: repo }], planning: { path: specs, places: [{ name: 'Specs', folder: 'specs' }] } });
  const task = await invoke('createTask', { companyId: labs.id, title: 'Revisar la galería', projectIds: ['demo'] });
  await invoke('updateTask', task.id, { isolated: false });
  writeFileSync(join(home, 'companies', labs.id, 'tasks', `${task.id}.md`), '## Estado\n\nFalta validar la **migracion** de imagenes.\n');
  await invoke('createTask', { companyId: retail.id, title: 'Unrelated retail task' });
  await page.reload();
  await page.getByRole('button', { name: 'Search everything' }).first().waitFor();

  await page.locator('.tree-client-row', { hasText: 'Gamma Logistics' }).dragTo(page.locator('.tree-client-row', { hasText: 'Alpha Labs' }));
  await page.waitForTimeout(500);
  const dragged = await clientOrder();
  ok(`drag moves a client: ${dragged}`, dragged[0] === 'Gamma Logistics');
  await page.locator('.tree-client-name', { hasText: 'Beta Retail' }).focus();
  await page.keyboard.press('Alt+ArrowUp');
  await page.waitForTimeout(400);
  const nudged = await clientOrder();
  ok(`Alt+Up moves a client: ${nudged}`, nudged.indexOf('Beta Retail') < nudged.indexOf('Alpha Labs'));
  await shot('prod-sidebar');

  await page.keyboard.press(shortcut('k'));
  const palette = page.getByRole('dialog', { name: 'Search everything' });
  await palette.waitFor();
  await shot('prod-palette-empty');
  const search = page.getByRole('combobox', { name: 'Search everything' });
  await search.fill('migracion');
  const noteHit = page.getByRole('option', { name: /Revisar la galería/ });
  await noteHit.waitFor();
  ok('finds text inside task notes', true);
  await search.fill('revisión csv');
  const fileHit = page.getByRole('option', { name: /exportacion/ });
  await fileHit.waitFor();
  ok('finds text inside a spec, ignoring accents', (await fileHit.innerText()).includes('CSV'));
  await shot('prod-palette-results');
  await page.keyboard.press('Enter');
  const editor = page.getByRole('heading', { name: 'Documents', exact: true });
  await editor.waitFor();
  await page.getByRole('heading', { name: 'Exportación' }).waitFor();
  ok('choosing a spec opens it in Documents, rendered', true);

  await page.getByText('1 file not committed').waitFor();
  ok('Documents shows what is not committed', true);
  await page.getByLabel('New document name').fill('Plan de viaje');
  await page.getByRole('button', { name: 'New document' }).click();
  const planFile = join(specs, 'specs', 'Plan de viaje.md');
  await page.getByRole('heading', { name: 'Plan de viaje' }).waitFor();
  ok('new document lands in the planning folder', readFileSync(planFile, 'utf8') === '# Plan de viaje\n');
  const editorOpened = async () => {
    for (let tries = 0; tries < 50; tries += 1) {
      if (existsSync(editorLog) && readFileSync(editorLog, 'utf8').includes(planFile)) return true;
      await page.waitForTimeout(100);
    }
    return false;
  };
  ok('a new document opens in the editor', await editorOpened());
  ok('Documents has no inline editor', (await page.locator('.documents-page textarea').count()) === 0);
  writeFileSync(planFile, '# Plan de viaje\n\nPaso uno.\n');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText('Paso uno.').waitFor();
  ok('what changes in the editor shows when coming back', true);
  await page.getByRole('tab', { name: /Knowledge/ }).click();
  await page.getByText('Choose a file on the left to see it here.').waitFor();
  ok('document types are a menu above the files', true);
  await page.getByRole('tab', { name: /Planning/ }).click();
  await page.getByRole('tree', { name: 'Files' }).getByRole('button', { name: 'Plan de viaje.md' }).click();
  await page.getByRole('button', { name: 'Edit in VS Code' }).click();
  await shot('prod-documents');

  await page.locator('.nav-name', { hasText: 'Alpha Labs' }).click();
  await page.getByRole('button', { name: /Revisar la galería/ }).first().click();
  await page.getByRole('tab', { name: 'Details' }).click();
  await page.getByText('2 files were already changed before the agent started').waitFor();
  await page.getByRole('button', { name: 'Show them' }).click();
  await page.getByRole('button', { name: /app\.txt/ }).click();
  const diff = page.getByLabel('Changes in app.txt');
  await diff.waitFor();
  const diffText = await diff.innerText();
  ok('changes show a real diff', diffText.includes('+three') && diffText.includes('-two'));
  await page.getByRole('button', { name: /new\.txt/ }).click();
  await page.getByLabel('Changes in new.txt').getByText('+brand new').waitFor();
  ok('untracked file is shown', true);
  await page.locator('.notes-view .file-preview strong', { hasText: 'migracion' }).waitFor();
  ok('task notes render as Markdown', true);
  await shot('prod-task-details');
  const hasScrollX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  ok('no sideways scroll', !hasScrollX);

  assert.equal((await invoke('getStayAwake')).active, false);
  await page.keyboard.press(shortcut(','));
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  await page.getByLabel('Keep this computer awake and the screen unlocked').selectOption('always');
  await page.getByText('Keeping this computer awake now.').waitFor();
  await page.getByRole('button', { name: 'Keeping this computer awake' }).waitFor();
  await shot('prod-settings');
  await page.getByLabel('Keep this computer awake and the screen unlocked').selectOption('sessions');
  await page.getByText('Keeping this computer awake now.').waitFor({ state: 'detached' });
  assert.equal((await invoke('getStayAwake')).active, false);

  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('.tree-client').first().waitFor();
  const after = await clientOrder();
  ok(`order survives a restart: ${after}`, after.join() === nudged.join());
  invoke = (method, ...args) => page.evaluate(([name, input]) => window.hatstand.invoke(name, ...input), [method, args]);
  ok('stay awake choice survives a restart', (await invoke('getStayAwake')).mode === 'sessions');
  console.log('productivity test passed');
} finally {
  await app.close().catch(() => {});
  rmSync(root, { recursive: true, force: true });
}
