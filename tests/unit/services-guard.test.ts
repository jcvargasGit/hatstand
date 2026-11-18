import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGuardScript } from '../../src/main/guard/hook-script';
import { installPreCommitHook } from '../../src/main/guard/install';
import { createGuardService, createRepoProtection } from '../../src/main/services/guard';
import { prepareWorkspace } from '../../src/main/services/startup';
import { makeGitRepo, makeHome, type TestHome } from '../helpers/home';
import { fakeServiceDeps, makeServiceContext, memorySecrets } from '../helpers/services';

let home: TestHome;
let api: string;
let web: string;
beforeEach(() => {
  home = makeHome('hatstand-guard-services-');
  api = makeGitRepo(home.folder('code', 'api'));
  web = makeGitRepo(home.folder('code', 'web'));
  home.store.saveCompany({
    ...home.store.createCompany('Acme', '#112233'),
    projects: [
      { id: 'api', name: 'api', path: api },
      { id: 'web', name: 'web', path: web },
    ],
  });
});
afterEach(() => home.remove());

describe('the commit protection of a client', () => {
  it('reports each repository, and remembers which ones are protected', async () => {
    installPreCommitHook(api, '/node', '/guard.cjs');
    const { ctx, stateChanges } = makeServiceContext(home);
    const guard = createGuardService(ctx, fakeServiceDeps());

    const status = await guard.guardStatus('acme');
    expect(status.map(({ name, state }) => ({ name, state }))).toEqual([{ name: 'api', state: 'protected' }, { name: 'web', state: 'missing' }]);
    expect(home.store.readCompany('acme').protectedPaths).toEqual([api]);
    expect(stateChanges()).toBe(1);
  });

  it('saves nothing when what it remembers is still true, in any order', async () => {
    installPreCommitHook(api, '/node', '/guard.cjs');
    installPreCommitHook(web, '/node', '/guard.cjs');
    home.store.saveCompany({ ...home.store.readCompany('acme'), protectedPaths: [web, api] });
    const { ctx, stateChanges } = makeServiceContext(home);
    const save = vi.spyOn(home.store, 'saveCompany');

    await createGuardService(ctx, fakeServiceDeps()).guardStatus('acme');
    expect(save).not.toHaveBeenCalled();
    expect(stateChanges()).toBe(0);
  });

  it('forgets a repository whose check was removed outside Hatstand', async () => {
    home.store.saveCompany({ ...home.store.readCompany('acme'), protectedPaths: [api] });
    const { ctx, stateChanges } = makeServiceContext(home);
    await createGuardService(ctx, fakeServiceDeps()).guardStatus('acme');
    expect(home.store.readCompany('acme').protectedPaths).toEqual([]);
    expect(stateChanges()).toBe(1);
  });

  it('installs the check after taking it out of the control repositories, and remembers where it went', async () => {
    const { ctx, stateChanges } = makeServiceContext(home);
    const deps = fakeServiceDeps();
    const save = vi.spyOn(home.store, 'saveCompany');
    const report = await createGuardService(ctx, deps).installGuard('acme');

    expect(report.installed.sort()).toEqual([api, web].sort());
    expect(deps.protection.clearControlRepoHooks).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'acme' }));
    expect(vi.mocked(deps.protection.clearControlRepoHooks).mock.invocationCallOrder[0]).toBeLessThan(save.mock.invocationCallOrder[0] ?? 0);
    expect(home.store.readCompany('acme').protectedPaths.sort()).toEqual([api, web].sort());
    expect(stateChanges()).toBe(1);
  });
});

describe('keeping the commit check up to date', () => {
  it('refreshes every client, even when one of them fails', () => {
    home.store.createCompany('Other', '#223344');
    mkdirSync(home.paths.guardDir, { recursive: true });
    writeFileSync(home.paths.guardFingerprints('acme'), '{}');
    writeFileSync(home.paths.guardFingerprints('other'), '{}');
    const secrets = memorySecrets();
    const read = secrets.read;
    secrets.read = (companyId) => {
      if (companyId === 'acme') throw new Error('The keychain is locked.');
      return read(companyId);
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    createRepoProtection({ ...makeServiceContext(home).ctx, secrets }).refreshAllFingerprints();
    expect(logged).toHaveBeenCalledWith('Commit protection could not be updated for acme.', expect.any(Error));
    expect(JSON.parse(readFileSync(home.paths.guardFingerprints('other'), 'utf8'))).toMatchObject({ company: 'Other' });
    expect(readFileSync(home.paths.guardFingerprints('acme'), 'utf8')).toBe('{}');
  });
});

describe('preparing the data folder at startup', () => {
  it('marks every session stopped, and clears the control repositories of each client', () => {
    home.store.createCompany('Other', '#223344');
    const task = home.store.createTask({ companyId: 'acme', title: 'Fix' });
    home.store.saveSession({ id: '00000000-0000-4000-8000-000000000001', taskId: task.id, companyId: 'acme', accountId: 'a', cwd: '/', state: 'working', startedAt: 'x', updatedAt: 'x' });
    const { protection } = fakeServiceDeps();

    prepareWorkspace(makeServiceContext(home).ctx, { protection });
    expect(home.store.listSessions().map((session) => session.state)).toEqual(['stopped']);
    expect(vi.mocked(protection.clearControlRepoHooks).mock.calls.map(([company]) => company.id).sort()).toEqual(['acme', 'other']);
  });

  it('brings the check script up to date, and does not install one nobody asked for', () => {
    const { ctx } = makeServiceContext(home);
    const { protection } = fakeServiceDeps();
    prepareWorkspace(ctx, { protection });
    expect(existsSync(home.paths.guardScript)).toBe(false);

    mkdirSync(home.paths.guardDir, { recursive: true });
    writeFileSync(home.paths.guardScript, 'old script');
    prepareWorkspace(ctx, { protection });
    expect(readFileSync(home.paths.guardScript, 'utf8')).toBe(buildGuardScript());
  });
});
