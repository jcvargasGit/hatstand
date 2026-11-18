import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClientFileService } from '../../src/main/services/client-files';
import { createRepoProtection } from '../../src/main/services/guard';
import { makeHome, type TestHome } from '../helpers/home';
import { makeServiceContext, memorySecrets } from '../helpers/services';

let home: TestHome;
let knowledge: string;
beforeEach(() => {
  home = makeHome('hatstand-client-file-services-');
  home.store.createCompany('Acme', '#112233');
  home.store.createCompany('Globex', '#223344');
  knowledge = home.paths.knowledgeDir('acme');
  mkdirSync(knowledge, { recursive: true });
});
afterEach(() => home.remove());

const ACME_KEY = 'sk-live-acme-0123456789'; // gitleaks:allow
const GLOBEX_KEY = 'sk-live-globex-0123456789'; // gitleaks:allow

function setup() {
  const secrets = memorySecrets({ acme: { API_KEY: ACME_KEY }, globex: { API_KEY: GLOBEX_KEY } });
  const { ctx, stateChanges } = makeServiceContext(home, secrets);
  return { files: createClientFileService(ctx, { protection: createRepoProtection(ctx) }), stateChanges };
}

describe('the files of a client', () => {
  it('lists its text files, and leaves out hidden files and other kinds', async () => {
    writeFileSync(join(knowledge, 'map.md'), '# Map');
    writeFileSync(join(knowledge, '.draft.md'), 'hidden');
    writeFileSync(join(knowledge, 'logo.png'), 'binary');
    const names = (await setup().files.listClientFiles('acme')).filter((file) => file.scope === 'knowledge').map((file) => file.name);
    expect(names).toContain('map.md');
    expect(names).not.toContain('.draft.md');
    expect(names).not.toContain('logo.png');
  });

  it('reads a file of the client, and refuses one of another client', async () => {
    writeFileSync(join(knowledge, 'map.md'), '# Map');
    const other = join(home.paths.knowledgeDir('globex'), 'secret.md');
    mkdirSync(home.paths.knowledgeDir('globex'), { recursive: true });
    writeFileSync(other, 'Globex only');
    const { files } = setup();
    expect(await files.readClientFile('acme', join(knowledge, 'map.md'))).toEqual({ content: '# Map' });
    await expect(files.readClientFile('acme', other)).rejects.toThrow(`${other} is not a file of this client.`);
  });
});

describe('creating a document', () => {
  const fingerprints = () => JSON.parse(readFileSync(home.paths.guardFingerprints('acme'), 'utf8'));
  beforeEach(() => {
    mkdirSync(home.paths.guardDir, { recursive: true });
    writeFileSync(home.paths.guardFingerprints('acme'), '{}');
  });

  it('writes it with a title, and lets the commit check know it, with the secrets of this client', async () => {
    const { files, stateChanges } = setup();
    const file = await files.createDocument('acme', 'knowledge', 'Meeting notes');
    expect(file).toBe(join(knowledge, 'Meeting notes.md'));
    expect(readFileSync(file, 'utf8')).toBe('# Meeting notes\n');
    expect(fingerprints()).toMatchObject({ company: 'Acme', secrets: [{ name: 'API_KEY', length: ACME_KEY.length }] });
    expect(stateChanges()).toBe(1);
  });

  it.each([
    ['a name with other characters', 'notes/../../x', 'Use letters, numbers, spaces, dots, dashes or underscores in the name.'],
    ['a file that is not text', 'logo.png', 'Use a text file, such as a .md file.'],
    ['a place it does not know', 'Notes', 'Choose where to save this document.', 'elsewhere'],
  ])('refuses %s, and writes nothing', async (_name, name, message, where = 'knowledge') => {
    const { files, stateChanges } = setup();
    await expect(files.createDocument('acme', where, name)).rejects.toThrow(message);
    expect(fingerprints()).toEqual({});
    expect(stateChanges()).toBe(0);
  });

  it('does not write over a document', async () => {
    writeFileSync(join(knowledge, 'Notes.md'), 'mine');
    await expect(setup().files.createDocument('acme', 'knowledge', 'Notes')).rejects.toThrow('There is already a file called Notes.md here.');
    expect(readFileSync(join(knowledge, 'Notes.md'), 'utf8')).toBe('mine');
  });
});

describe('switching a client folder', () => {
  it('counts what would be left behind: the files, and the tasks still open', async () => {
    writeFileSync(join(knowledge, 'README.md'), 'starter');
    mkdirSync(join(knowledge, 'deep'));
    writeFileSync(join(knowledge, 'deep', 'a.md'), 'a');
    writeFileSync(join(knowledge, 'b.md'), 'b');
    home.store.createTask({ companyId: 'acme', title: 'To do' });
    home.store.updateTask(home.store.createTask({ companyId: 'acme', title: 'Doing' }).id, { status: 'doing' });
    home.store.updateTask(home.store.createTask({ companyId: 'acme', title: 'Done' }).id, { status: 'done' });
    home.store.updateTask(home.store.createTask({ companyId: 'acme', title: 'Archived' }).id, { archivedAt: '2026-01-01' });
    home.store.createTask({ companyId: 'acme', title: 'Idea' }, undefined, 'idea');
    expect(await setup().files.folderSwitchImpact('acme', 'knowledge')).toEqual({ from: knowledge, files: 2, openTasks: 2 });
  });

  it('lists the folders used before for a section, newest first, and whether each is still there', async () => {
    const [first, second, current] = ['first', 'second', 'current'].map((name) => home.folder(name));
    for (const folder of [first, second, current]) {
      home.store.saveCompany({ ...home.store.readCompany('acme'), context: { ...home.store.readCompany('acme').context, knowledgeDir: folder } });
    }
    rmSync(first!, { recursive: true });
    expect(await setup().files.listPastFolders('acme', 'knowledge')).toEqual([
      { path: second, leftAt: expect.any(String), exists: true },
      { path: first, leftAt: expect.any(String), exists: false },
    ]);
    expect(await setup().files.listPastFolders('acme', 'planning')).toEqual([]);
  });

  it('tells a folder of LLM config from any other folder', async () => {
    const plugin = home.folder('plugin');
    mkdirSync(join(plugin, 'skills'));
    const { files } = setup();
    expect(await files.isPluginFolder(plugin)).toBe(true);
    expect(await files.isPluginFolder(home.folder('empty'))).toBe(false);
    expect(await files.isPluginFolder(join(home.root, 'missing'))).toBe(false);
  });
});
