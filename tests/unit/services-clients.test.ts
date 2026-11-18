import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClientService } from '../../src/main/services/clients';
import { makeGitRepo, makeHome, type TestHome } from '../helpers/home';
import { fakeCopies, fakeServiceDeps, makeServiceContext, memorySecrets, reply } from '../helpers/services';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let home: TestHome;
beforeEach(() => {
  home = makeHome('hatstand-client-services-');
  home.store.createCompany('Acme', '#112233');
});
afterEach(() => home.remove());

function setup(fetch?: typeof globalThis.fetch) {
  const { ctx, stateChanges } = makeServiceContext(home, memorySecrets(), fetch);
  const deps = fakeServiceDeps();
  const copies = fakeCopies();
  return { clients: createClientService(ctx, { ...deps, copies }), deps, copies, ctx, stateChanges };
}

describe('adding a client', () => {
  it('gives each client an id of its own, from its name', async () => {
    const { clients } = setup();
    expect((await clients.createCompany('Globex', '#223344')).id).toBe('globex');
    expect((await clients.createCompany('Acme', '#223344', 'scratch')).id).toBe('acme-2');
    expect(home.store.readCompany('acme-2')).toMatchObject({ name: 'Acme', origin: 'scratch' });
  });

  it('saves the changes to a client, and returns it as saved', async () => {
    const { clients } = setup();
    const saved = await clients.saveCompany({ ...home.store.readCompany('acme'), name: 'Acme Corp' });
    expect(saved.name).toBe('Acme Corp');
    expect(home.store.readCompany('acme').name).toBe('Acme Corp');
  });
});

describe('the photo of a client', () => {
  it('downloads the photo from its link, and shows it from the saved copy', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => reply(200, PNG));
    const { clients } = setup(fetch);
    await clients.setClientPhoto('acme', 'https://example.com/logo.png');
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://example.com/logo.png', expect.anything());
    expect(await clients.readClientPhoto('acme')).toBe(`data:image/png;base64,${Buffer.from(PNG).toString('base64')}`);
    expect(home.store.readCompany('acme').photo).toMatchObject({ sourceUrl: 'https://example.com/logo.png', type: 'image/png' });
  });

  it('keeps no photo when the link does not open an image', async () => {
    const { clients } = setup(async () => reply(200, '<html>A page</html>'));
    await expect(clients.setClientPhoto('acme', 'https://example.com/page')).rejects.toThrow('That link does not open a PNG, JPEG, WebP or GIF image.');
    expect(await clients.readClientPhoto('acme')).toBeNull();
    expect(home.store.readCompany('acme').photo).toBeUndefined();
  });

  it('says so when the link cannot be reached', async () => {
    const { clients } = setup();
    await expect(clients.setClientPhoto('acme', 'https://example.com/logo.png')).rejects.toThrow('Could not reach that link.');
  });

  it('removes the photo', async () => {
    const { clients } = setup(async () => reply(200, PNG));
    await clients.setClientPhoto('acme', 'https://example.com/logo.png');
    await clients.removeClientPhoto('acme');
    expect(await clients.readClientPhoto('acme')).toBeNull();
    expect(existsSync(home.paths.photoFile('acme'))).toBe(false);
  });
});

describe('resetting the client folder', () => {
  it('uses the folder that holds every repository of the client', async () => {
    const code = home.folder('code', 'acme');
    home.store.saveCompany({ ...home.store.readCompany('acme'), projects: [{ id: 'api', name: 'api', path: makeGitRepo(join(code, 'api')) }, { id: 'web', name: 'web', path: makeGitRepo(join(code, 'web')) }] });
    const { clients, stateChanges } = setup();
    await clients.resetClientFolder('acme');
    expect(home.store.readCompany('acme').rootDir).toBe(code);
    expect(stateChanges()).toBe(1);
  });

  it('makes a projects folder in the home folder when there is nothing to share', async () => {
    const { clients, ctx } = setup();
    await clients.resetClientFolder('acme');
    const folder = join(ctx.userHome, 'projects', 'acme');
    expect(home.store.readCompany('acme').rootDir).toBe(folder);
    expect(existsSync(folder)).toBe(true);
  });
});

describe('archiving a client', () => {
  it('will not archive a client with a running session', async () => {
    const { clients, deps, stateChanges } = setup();
    vi.mocked(deps.sessions.hasLiveClientSession).mockReturnValue(true);
    await expect(clients.archiveClient('acme')).rejects.toThrow('Stop this client\'s sessions before archiving it.');
    expect(deps.sessions.hasLiveClientSession).toHaveBeenCalledWith('acme');
    expect(home.store.readCompany('acme').archivedAt).toBeUndefined();
    expect(stateChanges()).toBe(0);
  });

  it('archives a client with the time, and restores it', async () => {
    const { clients, stateChanges } = setup();
    const before = Date.now();
    await clients.archiveClient('acme');
    expect(Date.parse(home.store.readCompany('acme').archivedAt ?? '')).toBeGreaterThanOrEqual(before - 1000);
    await clients.restoreClient('acme');
    expect(home.store.readCompany('acme').archivedAt).toBeUndefined();
    expect(stateChanges()).toBe(2);
  });
});

describe('removing a client', () => {
  beforeEach(() => {
    home.store.saveCompany({ ...home.store.readCompany('acme'), archivedAt: '2026-01-01' });
  });

  it('will not remove a client with a running session, nor touch the copies of its tasks', async () => {
    const { clients, deps, copies, stateChanges } = setup();
    home.store.createTask({ companyId: 'acme', title: 'One' });
    vi.mocked(deps.sessions.hasLiveClientSession).mockReturnValue(true);
    await expect(clients.removeClient('acme', true)).rejects.toThrow('Stop this client\'s sessions before removing it.');
    expect(copies.removeCopies).not.toHaveBeenCalled();
    expect(home.store.listCompanies().map((company) => company.id)).toEqual(['acme']);
    expect(stateChanges()).toBe(0);
  });

  it('keeps the client when a copy of the code has work in it', async () => {
    const { ctx, deps, stateChanges } = setup();
    home.store.createTask({ companyId: 'acme', title: 'One' });
    const clients = createClientService(ctx, { ...deps, copies: fakeCopies(vi.fn(async () => Promise.reject(new Error('api: has files that are not committed.')))) });
    await expect(clients.removeClient('acme', true)).rejects.toThrow('not committed');
    expect(home.store.listCompanies().map((company) => company.id)).toEqual(['acme']);
    expect(stateChanges()).toBe(0);
  });

  it('removes only clean copies of every task, then the client', async () => {
    const { clients, copies, stateChanges } = setup();
    const ids = ['One', 'Two'].map((title) => home.store.createTask({ companyId: 'acme', title }).id);
    const report = await clients.removeClient('acme', true);
    expect(vi.mocked(copies.removeCopies).mock.calls.map(([taskId, onlyIfClean]) => [taskId, onlyIfClean]).sort()).toEqual(ids.map((id) => [id, true]).sort());
    expect(home.store.listCompanies()).toEqual([]);
    expect(report.keptFilesIn).toBeUndefined();
    expect(stateChanges()).toBe(1);
  });
});

describe('the areas of a client', () => {
  it('adds an area, and deletes it', async () => {
    const { clients, stateChanges } = setup();
    const area = await clients.createArea('acme', 'Billing');
    expect(home.store.readCompany('acme').subdomains.map((item) => item.name)).toContain('Billing');
    await clients.deleteArea('acme', area.id);
    expect(home.store.readCompany('acme').subdomains.map((item) => item.id)).not.toContain(area.id);
    expect(stateChanges()).toBe(2);
  });

  it('will not delete the default area, where tasks without another area live', async () => {
    const { clients, stateChanges } = setup();
    const company = home.store.readCompany('acme');
    await expect(clients.deleteArea('acme', company.defaultAreaId ?? '')).rejects.toThrow('is the default area of this client');
    expect(home.store.readCompany('acme').subdomains).toEqual(company.subdomains);
    expect(stateChanges()).toBe(0);
  });
});
