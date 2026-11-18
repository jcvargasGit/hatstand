import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopTargets, webLink } from '../../src/main/services/desktop-targets';
import { createNewTaskDraftService } from '../../src/main/services/new-task-drafts';
import { createReleaseService } from '../../src/main/services/release';
import { importEnvFile } from '../../src/main/services/secrets';
import { newTaskDraftSchema, type NewTaskDraft } from '../../src/shared/new-task-draft';
import { makeHome, type TestHome } from '../helpers/home';
import { makeServiceContext, memorySecrets } from '../helpers/services';

let home: TestHome;
let code: string;
beforeEach(() => {
  home = makeHome('hatstand-desktop-services-');
  code = home.folder('code', 'api');
  home.store.saveCompany({ ...home.store.createCompany('Acme', '#112233'), projects: [{ id: 'api', name: 'api', path: code }] });
});
afterEach(() => {
  vi.unstubAllEnvs();
  home.remove();
});

const targets = () => createDesktopTargets(makeServiceContext(home).ctx);
const draft = (fields: Partial<NewTaskDraft> = {}): NewTaskDraft => newTaskDraftSchema.parse({ companyId: 'acme', ...fields });

describe('what the editor may open for a client', () => {
  it('opens a repository as a folder, and a file inside it as a file', () => {
    writeFileSync(join(code, 'main.ts'), '');
    expect(targets().inEditor('acme', code)).toEqual({ kind: 'folder', path: code });
    expect(targets().inEditor('acme', join(code, 'main.ts'))).toEqual({ kind: 'file', path: join(code, 'main.ts') });
  });

  it('opens the copy a task has of the code, and a document its agent wrote', () => {
    const copy = home.folder('copies', 'api');
    const task = home.store.setTaskCode(home.store.createTask({ companyId: 'acme', title: 'Fix it' }).id, [{ projectId: 'api', path: copy, branch: 'hatstand/fix', base: 'HEAD' }]);
    const report = join(home.paths.tasksDir('acme'), `${task.id}.report.md`);
    writeFileSync(report, '# Report');
    expect(targets().inEditor('acme', copy)).toEqual({ kind: 'folder', path: copy });
    expect(targets().inEditor('acme', report)).toEqual({ kind: 'file', path: report });
  });

  it('refuses a path outside the client', () => {
    expect(() => targets().inEditor('acme', home.folder('elsewhere'))).toThrow('This is not part of this client.');
  });
});

describe('the folders and files of a client to open', () => {
  it('gives the folder of each section, and makes sure it exists', () => {
    const knowledge = targets().clientFolder('acme', 'knowledge');
    expect(knowledge).toBe(home.paths.knowledgeDir('acme'));
    expect(existsSync(knowledge)).toBe(true);
  });

  it('gives the instructions file when the client has one', () => {
    const company = home.store.readCompany('acme');
    home.store.saveCompany({ ...company, context: { ...company.context, instructionsFile: join(code, 'CLAUDE.md') } });
    expect(targets().clientFolder('acme', 'instructions')).toBe(join(code, 'CLAUDE.md'));
  });

  it('gives a knowledge file, and refuses a file that is not of the client', () => {
    const note = join(home.paths.knowledgeDir('acme'), 'note.md');
    writeFileSync(note, 'hello');
    expect(targets().clientFile('acme', note)).toBe(note);
    const outside = join(home.folder('elsewhere'), 'note.md');
    writeFileSync(outside, 'hello');
    expect(() => targets().clientFile('acme', outside)).toThrow(`${outside} is not a file of this client.`);
  });

  it('gives the folder of an area, unless the area is gone', () => {
    const area = home.store.createArea('acme', 'Billing');
    expect(targets().areaFolder('acme', area.id)).toBe(home.paths.areaDir('acme', 'billing'));
    expect(() => targets().areaFolder('acme', 'gone')).toThrow('This area is no longer part of this client.');
  });
});

describe('the folders and files of a task to open', () => {
  it('gives the copy of a repository, and says when the task has none or its folder is gone', () => {
    const copy = home.folder('copies', 'api');
    const gone = join(home.root, 'gone');
    const task = home.store.setTaskCode(home.store.createTask({ companyId: 'acme', title: 'Fix it' }).id, [
      { projectId: 'api', path: copy, branch: 'hatstand/fix', base: 'HEAD' },
      { projectId: 'web', path: gone, branch: 'hatstand/fix', base: 'HEAD' },
    ]);
    expect(targets().taskCopy(task.id, 'api')).toBe(copy);
    expect(() => targets().taskCopy(task.id, 'docs')).toThrow('This task has no copy of that repository.');
    expect(() => targets().taskCopy(task.id, 'web')).toThrow(`The folder ${gone} is gone.`);
  });

  it('gives the folder the agent of the task works in', () => {
    const task = home.store.createTask({ companyId: 'acme', title: 'Fix it', projectIds: ['api'], isolated: false });
    expect(targets().taskFolder(task.id)).toBe(code);
  });

  it('gives the notes file, and creates it when the task has none yet', () => {
    const task = home.store.createTask({ companyId: 'acme', title: 'Fix it' });
    const file = home.paths.notesFile('acme', task.id);
    expect(existsSync(file)).toBe(false);
    expect(targets().taskNotes(task.id)).toBe(file);
    expect(readFileSync(file, 'utf8')).toBe('');

    writeFileSync(file, 'kept');
    targets().taskNotes(task.id);
    expect(readFileSync(file, 'utf8')).toBe('kept');
  });

  it('gives a document the agent wrote, and refuses any other name', () => {
    const task = home.store.createTask({ companyId: 'acme', title: 'Fix it' });
    const report = join(home.paths.tasksDir('acme'), `${task.id}.report.md`);
    writeFileSync(report, '# Report');
    expect(targets().taskOutput(task.id, 'report.md')).toBe(report);
    expect(() => targets().taskOutput(task.id, 'other.md')).toThrow('other.md is not an output of this task.');
  });
});

describe('a link to open in the browser', () => {
  it('lets web links through', () => {
    expect(webLink('https://example.com/a')).toBe('https://example.com/a');
    expect(webLink('http://example.com')).toBe('http://example.com');
  });

  it('refuses anything else', () => {
    expect(() => webLink('file:///etc/passwd')).toThrow('Only web links can be opened.');
    expect(() => webLink('not a link')).toThrow();
  });
});

describe('importing an env file as secrets of a client', () => {
  it('saves its values, and says how many', () => {
    const secrets = memorySecrets({ acme: { KEPT: 'k' } });
    const { ctx, stateChanges } = makeServiceContext(home, secrets);
    const file = join(home.root, '.env');
    writeFileSync(file, 'API_KEY=one\nOTHER=two\n');
    expect(importEnvFile(ctx, 'acme', file)).toBe(2);
    expect(secrets.read('acme')).toEqual({ KEPT: 'k', API_KEY: 'one', OTHER: 'two' });
    expect(stateChanges()).toBe(1);
  });

  it('does nothing when the person chose no file', () => {
    const secrets = memorySecrets();
    const { ctx, stateChanges } = makeServiceContext(home, secrets);
    expect(importEnvFile(ctx, 'acme', null)).toBe(0);
    expect(secrets.names('acme')).toEqual([]);
    expect(stateChanges()).toBe(0);
  });
});

describe('a task being written in a window of its own', () => {
  function setup() {
    const { ctx, emitted } = makeServiceContext(home);
    const closed = new Map<string, () => void>();
    const windows = { open: vi.fn((draftId: string, onClosed: () => void) => void closed.set(draftId, onClosed)), close: vi.fn() };
    return { drafts: createNewTaskDraftService(ctx, { windows }), windows, emitted, closeWindow: (draftId: string) => closed.get(draftId)?.() };
  }

  it('opens a window for the draft, and keeps the draft for it to read', async () => {
    const { drafts, windows } = setup();
    const draftId = await drafts.openNewTaskWindow(draft({ title: 'Export' }));
    expect(windows.open).toHaveBeenCalledExactlyOnceWith(draftId, expect.any(Function));
    expect(await drafts.readNewTaskDraft(draftId)).toMatchObject({ companyId: 'acme', title: 'Export', priority: 'none', projectIds: [] });
  });

  it('opens no window for a draft that is not valid', async () => {
    const { drafts, windows } = setup();
    await expect(drafts.openNewTaskWindow({ title: 'No client' } as unknown as NewTaskDraft)).rejects.toThrow();
    expect(windows.open).not.toHaveBeenCalled();
  });

  it('saves what the person writes, until the window closes', async () => {
    const { drafts, closeWindow } = setup();
    const draftId = await drafts.openNewTaskWindow(draft());
    await drafts.saveNewTaskDraft(draftId, draft({ title: 'Export as CSV' }));
    expect((await drafts.readNewTaskDraft(draftId))?.title).toBe('Export as CSV');

    closeWindow(draftId);
    expect(await drafts.readNewTaskDraft(draftId)).toBeNull();
    await drafts.saveNewTaskDraft(draftId, draft({ title: 'Late' }));
    expect(await drafts.readNewTaskDraft(draftId)).toBeNull();
  });

  it('tells the interface about the new task, then closes the window', async () => {
    const { drafts, windows, emitted } = setup();
    const draftId = await drafts.openNewTaskWindow(draft());
    const task = home.store.createTask({ companyId: 'acme', title: 'Export' });
    await drafts.finishNewTaskWindow(draftId, task.id);
    expect(emitted).toEqual([
      { event: 'state-changed', payload: null },
      { event: 'task-created', payload: { taskId: task.id, companyId: 'acme' } },
    ]);
    expect(windows.close).toHaveBeenCalledExactlyOnceWith(draftId);
  });

  it('leaves the window open when the task does not exist', async () => {
    const { drafts, windows, emitted } = setup();
    await expect(drafts.finishNewTaskWindow('draft', 'missing')).rejects.toThrow();
    expect(emitted).toEqual([]);
    expect(windows.close).not.toHaveBeenCalled();
  });
});

describe('installing the version being developed', () => {
  const release = (installedApp: { platform: NodeJS.Platform; isPackaged: boolean }) =>
    createReleaseService(makeServiceContext(home).ctx, { installedApp: { ...installedApp, appRoot: home.folder('app') } });

  it('is not offered outside the development copy, on other systems, or in the installed app', async () => {
    vi.stubEnv('HATSTAND_DEV_COPY', '');
    expect(await release({ platform: 'darwin', isPackaged: false }).getReleaseStatus()).toBeNull();
    vi.stubEnv('HATSTAND_DEV_COPY', '1');
    expect(await release({ platform: 'linux', isPackaged: false }).getReleaseStatus()).toBeNull();
    expect(await release({ platform: 'darwin', isPackaged: true }).getReleaseStatus()).toBeNull();
    await expect(release({ platform: 'linux', isPackaged: false }).startRelease()).resolves.toBeUndefined();
  });

  it('reports its status in the development copy on macOS', async () => {
    vi.stubEnv('HATSTAND_DEV_COPY', '1');
    expect(await release({ platform: 'darwin', isPackaged: false }).getReleaseStatus()).toMatchObject({ state: 'idle' });
  });
});
