import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_COPY_MESSAGE } from '../../src/main/dev-copy';
import { createPlanningService } from '../../src/main/services/planning';
import { makeCommittedRepo, makeGitRepo, makeHome, type TestHome } from '../helpers/home';
import { fakeServiceDeps, makeServiceContext } from '../helpers/services';

let home: TestHome;
beforeEach(() => {
  home = makeHome('hatstand-planning-services-');
  home.store.createCompany('Acme', '#112233');
});
afterEach(() => {
  vi.unstubAllEnvs();
  home.remove();
});

/** Git settings of the person for this test only, so the real ones are never read or changed. */
function gitSettings(text: string) {
  const file = join(home.root, 'gitconfig');
  writeFileSync(file, text);
  vi.stubEnv('GIT_CONFIG_GLOBAL', file);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
}

function setup() {
  const { ctx, stateChanges } = makeServiceContext(home);
  const deps = fakeServiceDeps();
  return { planning: createPlanningService(ctx, deps), protection: deps.protection, ctx, stateChanges };
}

describe('choosing a planning repository', () => {
  it('makes it the planning repository, then updates the commit protection, and tells the interface', async () => {
    const repo = makeGitRepo(home.folder('code', 'acme-planning'));
    mkdirSync(join(repo, 'decisions'), { recursive: true });
    home.store.saveCompany({ ...home.store.readCompany('acme'), projects: [{ id: 'plan', name: 'plan', path: repo }] });
    const { planning, protection, stateChanges } = setup();

    await planning.setPlanningRepo('acme', `${repo}/`);
    const saved = home.store.readCompany('acme');
    expect(saved.planning?.path).toBe(repo);
    expect(saved.projects).toEqual([]);
    expect(protection.clearControlRepoHooks).toHaveBeenCalledExactlyOnceWith(saved);
    expect(protection.refreshFingerprints).toHaveBeenCalledExactlyOnceWith(saved);
    expect(vi.mocked(protection.clearControlRepoHooks).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(protection.refreshFingerprints).mock.invocationCallOrder[0] ?? 0);
    expect(stateChanges()).toBe(1);
  });

  it.each([
    ['a folder that does not exist', () => join(home.root, 'missing'), 'does not exist.'],
    ['a folder that is not a repository', () => home.folder('notes'), 'is not a git repository.'],
    ['Hatstand\'s own data folder', () => home.paths.home, 'Choose a folder outside Hatstand\'s own data folder.'],
  ])('refuses %s, and changes nothing', async (_name, folder, message) => {
    const { planning, protection, stateChanges } = setup();
    await expect(planning.setPlanningRepo('acme', folder())).rejects.toThrow(message);
    expect(home.store.readCompany('acme').planning).toBeUndefined();
    expect(protection.clearControlRepoHooks).not.toHaveBeenCalled();
    expect(stateChanges()).toBe(0);
  });

  it('refuses a repository a task has its own copy of', async () => {
    const repo = makeGitRepo(home.folder('code', 'api'));
    home.store.saveCompany({ ...home.store.readCompany('acme'), projects: [{ id: 'api', name: 'api', path: repo }] });
    const task = home.store.createTask({ companyId: 'acme', title: 'Fix login' });
    home.store.setTaskCode(task.id, [{ projectId: 'api', path: join(home.root, 'copy'), branch: 'hatstand/fix', base: 'HEAD' }]);
    await expect(setup().planning.setPlanningRepo('acme', repo)).rejects.toThrow('The task "Fix login" has a copy of this repository.');
  });
});

describe('creating a planning repository', () => {
  it('creates it with a first commit, and makes it the planning repository', async () => {
    gitSettings('[user]\n\tname = Ana\n\temail = ana@acme.dev\n');
    const { planning, protection, ctx, stateChanges } = setup();
    await planning.createPlanningRepo('acme', '~/acme-planning');

    const target = join(ctx.userHome, 'acme-planning');
    expect(home.store.readCompany('acme').planning?.path).toBe(target);
    expect(execFileSync('git', ['log', '--format=%ae %s'], { cwd: target, encoding: 'utf8' }).trim()).toBe('ana@acme.dev Start the planning repository');
    expect(protection.clearControlRepoHooks).toHaveBeenCalledOnce();
    expect(protection.refreshFingerprints).toHaveBeenCalledOnce();
    expect(stateChanges()).toBe(1);
  });

  it('leaves nothing behind when git has no commit email', async () => {
    gitSettings('');
    const { planning, ctx, stateChanges } = setup();
    await expect(planning.createPlanningRepo('acme', '~/plans/acme-planning')).rejects.toThrow('Git has no commit email');
    expect(existsSync(join(ctx.userHome, 'plans'))).toBe(false);
    expect(readdirSync(ctx.userHome)).toEqual([]);
    expect(home.store.readCompany('acme').planning).toBeUndefined();
    expect(stateChanges()).toBe(0);
  });

  it('does not make a second one', async () => {
    const repo = makeCommittedRepo(home.folder('code', 'plans'));
    home.store.saveCompany({ ...home.store.readCompany('acme'), planning: { path: repo, places: [] } });
    await expect(setup().planning.createPlanningRepo('acme', '~/acme-planning')).rejects.toThrow('This client already has a planning repository.');
  });

  it('does not change real repositories from the development copy', async () => {
    vi.stubEnv('HATSTAND_DEV_COPY', '1');
    const { planning, ctx } = setup();
    await expect(planning.createPlanningRepo('acme', '~/acme-planning')).rejects.toThrow(DEV_COPY_MESSAGE);
    expect(readdirSync(ctx.userHome)).toEqual([]);
  });
});

describe('the folders of the planning repository', () => {
  it('suggests a folder next to the client\'s code', async () => {
    const { planning, ctx } = setup();
    expect(await planning.defaultPlanningFolder('acme')).toBe(join(ctx.userHome, 'projects', 'acme', 'acme-planning'));
  });

  it('lists the folders inside it, and none while there is no repository', async () => {
    const { planning } = setup();
    expect(await planning.listPlanningFolders('acme')).toEqual([]);
    const repo = makeGitRepo(home.folder('code', 'plans'));
    mkdirSync(join(repo, 'epics', 'login'), { recursive: true });
    home.store.saveCompany({ ...home.store.readCompany('acme'), planning: { path: repo, places: [] } });
    expect(await planning.listPlanningFolders('acme')).toEqual(['epics', 'epics/login']);
  });

  it('lists none when the repository was moved away', async () => {
    home.store.saveCompany({ ...home.store.readCompany('acme'), planning: { path: join(home.root, 'moved'), places: [] } });
    expect(await setup().planning.listPlanningFolders('acme')).toEqual([]);
  });
});
