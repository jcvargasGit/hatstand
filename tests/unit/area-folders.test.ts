import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateClientFolders, needsFolderMigration, OLD_PROJECT_STARTER_FILES } from '../../src/main/area-migration';
import { fingerprintText } from '../../src/main/guard/fingerprints';
import { buildFingerprints } from '../../src/main/guard/service';
import { dataPaths, type DataPaths } from '../../src/main/paths';
import { AREA_STARTER_FILES, Store, withFileLock } from '../../src/main/store';
import { placeAreaFolders, withCoreArea } from '../../src/shared/areas';
import { hasWorkspace } from '../../src/shared/readiness';
import { parseIssueReference } from '../../src/shared/issue-reference';
import { companySchema, type Subdomain } from '../../src/shared/schemas';

let dir: string;
let paths: DataPaths;
let store: Store;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-areas-')));
  paths = dataPaths(join(dir, 'home'));
  store = new Store(paths);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const area = (id: string, name: string, folder?: string): Subdomain => ({ id, name, folder, description: '', folders: [], links: [] });
const UUID_A = '3f2a9c10-5b7e-4d21-9e8a-1c4b6d7e8f90';
const UUID_B = '7d1e4b52-a8c3-4f6e-b0d9-2e5f7a8c9b13';
const OLD_PROJECT = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

describe('area folder names', () => {
  it('names folders after the area, with a suffix when two areas share a name', () => {
    const { areas, moves } = placeAreaFolders([area('a', 'Side project'), area('b', 'Side Project'), area('c', '***')], () => false);
    expect(areas.map((item) => item.folder)).toEqual(['side-project', 'side-project-2', 'area']);
    expect(moves).toEqual([]);
  });

  it('moves an old folder named by id, and keeps a folder already named', () => {
    const disk = new Set([UUID_A, 'kept']);
    const { areas, moves } = placeAreaFolders([area(UUID_A, 'Side project'), area('k', 'Renamed later', 'kept')], (folder) => disk.has(folder));
    expect(areas.map((item) => item.folder)).toEqual(['side-project', 'kept']);
    expect(moves).toEqual([{ from: UUID_A, to: 'side-project' }]);
  });

  it('adopts the readable folder when a move finished but was not saved', () => {
    const { areas, moves } = placeAreaFolders([area(UUID_A, 'Side project')], (folder) => folder === 'side-project');
    expect(areas[0]?.folder).toBe('side-project');
    expect(moves).toEqual([]);
  });

  it('never moves an old folder onto a folder that holds something else', () => {
    const disk = new Set([UUID_A, 'uploads']);
    const { moves } = placeAreaFolders([area(UUID_A, 'Uploads')], (folder) => disk.has(folder));
    expect(moves).toEqual([{ from: UUID_A, to: 'uploads-2' }]);
  });

  it('rejects a folder that could leave the areas folder', () => {
    expect(() => companySchema.parse({ id: 'c', name: 'C', color: '#112233', subdomains: [area('a', 'A', '../x')] })).toThrow();
  });
});

describe('the default area', () => {
  const company = (subdomains: Subdomain[], defaultAreaId?: string) => companySchema.parse({ id: 'c', name: 'C', color: '#112233', subdomains, defaultAreaId });

  it('adds Core when a client has no default area', () => {
    const next = withCoreArea(company([area('a', 'Gallery')]), () => 'new');
    expect(next.defaultAreaId).toBe('new');
    expect(next.subdomains.map((item) => item.name)).toEqual(['Core', 'Gallery']);
  });

  it('uses an area that is already called core instead of adding another', () => {
    const next = withCoreArea(company([area('a', 'Gallery'), area(UUID_B, 'core')]), () => 'new');
    expect(next.defaultAreaId).toBe(UUID_B);
    expect(next.subdomains).toHaveLength(2);
  });

  it('keeps the default area it already has', () => {
    const current = company([area('a', 'Gallery')], 'a');
    expect(withCoreArea(current, () => 'new')).toBe(current);
  });
});

describe('areas in the store', () => {
  it('gives every new client a Core area with readable files', () => {
    const client = store.createCompany('Acme', '#112233');
    const core = client.subdomains.find((item) => item.id === client.defaultAreaId);
    expect(core).toMatchObject({ name: 'Core', folder: 'core' });
    expect(readFileSync(join(paths.areaDir(client.id, 'core'), 'Instructions.md'), 'utf8')).toBe(AREA_STARTER_FILES['Instructions.md']);
  });

  it('keeps the folder when an area is renamed', () => {
    const client = store.createCompany('Acme', '#112233');
    const gallery = store.createArea(client.id, 'Gallery');
    expect(gallery.folder).toBe('gallery');
    const company = store.readCompany(client.id);
    store.saveCompany({ ...company, subdomains: company.subdomains.map((item) => (item.id === gallery.id ? { ...item, name: 'Uploads' } : item)) });
    expect(store.readCompany(client.id).subdomains.find((item) => item.id === gallery.id)?.folder).toBe('gallery');
    expect(existsSync(paths.areaDir(client.id, 'uploads'))).toBe(false);
  });

  it('puts every task in an area, Core when none is chosen', () => {
    const client = store.createCompany('Acme', '#112233');
    const gallery = store.createArea(client.id, 'Gallery');
    const task = store.createTask({ companyId: client.id, title: 'Anything' });
    expect(task.subdomainId).toBe(client.defaultAreaId);
    expect(store.updateTask(task.id, { subdomainId: gallery.id }).subdomainId).toBe(gallery.id);
    expect(store.updateTask(task.id, { subdomainId: undefined }).subdomainId).toBe(client.defaultAreaId);
    expect(() => store.createTask({ companyId: client.id, title: 'Lost', subdomainId: 'gone' })).toThrow('no longer part of this client');
  });

  it('does not delete the default area, and moves tasks of a deleted area to it', () => {
    const client = store.createCompany('Acme', '#112233');
    const gallery = store.createArea(client.id, 'Gallery');
    const task = store.createTask({ companyId: client.id, title: 'Monthly report', subdomainId: gallery.id });
    expect(() => store.deleteArea(client.id, client.defaultAreaId ?? '')).toThrow('cannot be deleted');
    store.deleteArea(client.id, gallery.id);
    expect(store.findTask(task.id).subdomainId).toBe(client.defaultAreaId);
  });
});

describe('where agents can work', () => {
  it('still asks a client with code for its code when it only has Core, but lets a client without code work in Core', () => {
    const withCode = store.createCompany('Acme', '#112233');
    expect(hasWorkspace(withCode)).toBe(false);
    expect(hasWorkspace(store.saveCompany({ ...withCode, hasCode: false }))).toBe(true);
    store.createArea(withCode.id, 'Gallery');
    expect(hasWorkspace(store.readCompany(withCode.id))).toBe(true);
  });
});

describe('moving today’s folders', () => {
  const writeOldClient = () => {
    const companyDir = paths.company('acme');
    mkdirSync(companyDir, { recursive: true });
    writeFileSync(
      paths.companyFile('acme'),
      stringify({ id: 'acme', name: 'Acme', color: '#112233', subdomains: [area(UUID_A, 'Side project'), area(UUID_B, 'core')].map(({ folder: _folder, ...rest }) => rest) }),
    );
    for (const id of [UUID_A, UUID_B]) {
      mkdirSync(join(paths.areasDir('acme'), id), { recursive: true });
      for (const [name, text] of Object.entries(AREA_STARTER_FILES)) writeFileSync(join(paths.areasDir('acme'), id, name), text);
    }
    writeFileSync(join(paths.areasDir('acme'), UUID_A, 'Notes.md'), 'My own notes');
    const oldProject = join(paths.oldProjectsDir('acme'), OLD_PROJECT);
    mkdirSync(oldProject, { recursive: true });
    for (const [name, text] of Object.entries(OLD_PROJECT_STARTER_FILES)) writeFileSync(join(oldProject, name), text);
    writeFileSync(join(oldProject, 'Notes.md'), '# Notes\n\nhttps://docs.example.com/guide\n');
    mkdirSync(paths.oldProjectsDir('old-empty'), { recursive: true });
    mkdirSync(paths.tasksDir('acme'), { recursive: true });
    writeFileSync(paths.taskFile('acme', 't1'), JSON.stringify({ id: 't1', number: 1, companyId: 'acme', title: 'Old', status: 'todo', createdAt: 'x', updatedAt: 'x' }));
    writeFileSync(paths.taskCounterFile('acme'), '1');
  };

  it('backs up, renames area folders, keeps content, adopts old project notes and places tasks', () => {
    writeOldClient();
    const report = migrateClientFolders(store, paths, 'acme', 'stamp');

    expect(report.backup).toBe(join(paths.backupsDir, 'folders-stamp', 'acme'));
    expect(readFileSync(join(report.backup ?? '', 'areas', UUID_A, 'Notes.md'), 'utf8')).toBe('My own notes');
    expect(existsSync(join(report.backup ?? '', 'projects', OLD_PROJECT, 'Notes.md'))).toBe(true);

    const company = store.readCompany('acme');
    expect(company.defaultAreaId).toBe(UUID_B);
    expect(company.subdomains.map((item) => item.folder)).toEqual(['side-project', 'core']);
    expect(readdirSync(paths.areasDir('acme')).sort()).toEqual(['core', 'side-project']);
    expect(readFileSync(join(paths.areaDir('acme', 'side-project'), 'Notes.md'), 'utf8')).toBe('My own notes');

    expect(readFileSync(join(paths.areaDir('acme', 'core'), 'from-old-project-9a1b2c3d', 'Notes.md'), 'utf8')).toContain('docs.example.com');
    expect(readdirSync(join(paths.areaDir('acme', 'core'), 'from-old-project-9a1b2c3d'))).toEqual(['Notes.md']);
    expect(existsSync(paths.oldProjectsDir('acme'))).toBe(false);

    expect(store.findTask('t1').subdomainId).toBe(UUID_B);
    expect(needsFolderMigration(paths, company)).toBe(false);
  });

  it('does nothing, and makes no backup, once the folders are up to date', () => {
    writeOldClient();
    migrateClientFolders(store, paths, 'acme', 'first');
    expect(migrateClientFolders(store, paths, 'acme', 'second').backup).toBeUndefined();
    expect(existsSync(join(paths.backupsDir, 'folders-second'))).toBe(false);
  });

  it('finishes a migration that stopped after moving a folder', () => {
    writeOldClient();
    renameSync(join(paths.areasDir('acme'), UUID_A), join(paths.areasDir('acme'), 'side-project'));
    migrateClientFolders(store, paths, 'acme', 'stamp');
    expect(readFileSync(join(paths.areaDir('acme', 'side-project'), 'Notes.md'), 'utf8')).toBe('My own notes');
    expect(existsSync(paths.areaDir('acme', 'side-project-2'))).toBe(false);
  });
});

describe('task numbers', () => {
  it('never gives a deleted task’s number to a new task', () => {
    const client = store.createCompany('Acme', '#112233');
    store.createTask({ companyId: client.id, title: 'One' });
    const second = store.createTask({ companyId: client.id, title: 'Two' });
    store.deleteTask(second.id);
    expect(store.createTask({ companyId: client.id, title: 'Three' }).number).toBe(3);
  });

  it('waits for another window that is creating a task, and clears a lock left behind', () => {
    const lock = join(dir, 'counter.lock');
    writeFileSync(lock, '');
    expect(() => withFileLock(lock, () => 1, 40)).toThrow('Another Hatstand window is creating a task.');
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    expect(withFileLock(lock, () => 7, 40)).toBe(7);
    expect(existsSync(lock)).toBe(false);
  });
});

describe('linking an issue by hand', () => {
  it('reads GitHub, GitLab and Jira links and keys', () => {
    expect(parseIssueReference('https://github.com/acme/api/issues/12')).toEqual({ kind: 'github', key: 'acme/api#12', url: 'https://github.com/acme/api/issues/12' });
    expect(parseIssueReference(' acme/api#12 ')).toMatchObject({ kind: 'github', key: 'acme/api#12', url: 'https://github.com/acme/api/issues/12' });
    expect(parseIssueReference('https://gitlab.example.com/group/sub/app/-/issues/7')).toEqual({
      kind: 'gitlab',
      key: 'group/sub/app#7',
      url: 'https://gitlab.example.com/group/sub/app/-/issues/7',
    });
    expect(parseIssueReference('https://acme.atlassian.net/browse/ACME-4')).toMatchObject({ kind: 'jira', key: 'ACME-4' });
    expect(parseIssueReference('ACME-4')).toEqual({ kind: 'jira', key: 'ACME-4' });
    for (const text of ['', 'fix login', 'https://github.com/acme/api', 'javascript:alert(1)']) expect(() => parseIssueReference(text)).toThrow('Paste the link');
  });

  it('keeps the local number, refuses an issue linked to another task, and can unlink', () => {
    const client = store.createCompany('Acme', '#112233');
    const first = store.createTask({ companyId: client.id, title: 'Login' });
    const second = store.createTask({ companyId: client.id, title: 'Other' });
    const source = parseIssueReference('acme/api#12');
    const linked = store.linkTaskSource(first.id, source);
    expect(linked).toMatchObject({ number: first.number, source, customTitle: true });
    expect(() => store.linkTaskSource(second.id, source)).toThrow(`acme/api#12 is already linked to task #${first.number}.`);
    expect(store.linkTaskSource(first.id, undefined).source).toBeUndefined();
  });
});

describe('commit protection of area files', () => {
  it('ignores the starter text of areas but protects what the person wrote', () => {
    const client = store.createCompany('Acme', '#112233');
    const mine = 'A line about this client that is long enough to protect.';
    writeFileSync(join(paths.areaDir(client.id, 'core'), 'Tips.md'), `${AREA_STARTER_FILES['Tips.md']}${mine}\n`);
    const { lineHashes } = buildFingerprints(paths, store.readCompany(client.id), {});
    expect(lineHashes).toEqual(fingerprintText(mine));
  });
});
