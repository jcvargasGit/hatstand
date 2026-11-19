import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepositoryService } from '../../src/main/services/repositories';
import type { GitSource } from '../../src/shared/schemas';
import { makeGitRepo, makeHome, type TestHome } from '../helpers/home';
import { makeServiceContext, memorySecrets, reply } from '../helpers/services';

const GITHUB: GitSource = { provider: 'github', owner: 'acme' };

/** GitHub, as far as listing the repositories of an organization goes. Only this token is let in. */
function fakeGitHub(names: string[], token = 'ghp_good') {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if ((init?.headers as Record<string, string>)?.Authorization !== `Bearer ${token}`) return reply(401);
    if (url === 'https://api.github.com/user') return reply(200, { login: 'me' });
    if (url === 'https://api.github.com/orgs/acme') return reply(200, {});
    if (url.startsWith('https://api.github.com/orgs/acme/repos?')) {
      return reply(200, names.map((name) => ({ name, description: `The ${name}`, clone_url: `https://github.com/acme/${name}.git` })));
    }
    return reply(404);
  });
}

/** A checkout already in place, as a download from GitHub leaves it, so a download finds it without the network. */
function checkout(path: string, origin: string): string {
  makeGitRepo(path);
  execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: path });
  return path;
}

let home: TestHome;
beforeEach(() => {
  home = makeHome('hatstand-repository-services-');
  home.store.createCompany('Acme', '#112233');
});
afterEach(() => home.remove());

function setup(fetch?: typeof globalThis.fetch, secrets = memorySecrets()) {
  const { ctx, emitted, stateChanges } = makeServiceContext(home, secrets, fetch);
  return { repositories: createRepositoryService(ctx), ctx, secrets, emitted, stateChanges };
}

describe('connecting GitHub or GitLab', () => {
  it('lists the repositories with the pasted token, and keeps the token and the source', async () => {
    const { repositories, secrets, stateChanges } = setup(fakeGitHub(['web', 'api']));
    const repos = await repositories.connectGitSource('acme', GITHUB, '  ghp_good  ');
    expect(repos.map((repo) => repo.path)).toEqual(['api', 'web']);
    expect(secrets.read('acme')).toEqual({ GITHUB_TOKEN: 'ghp_good' });
    expect(home.store.readCompany('acme').gitSource).toEqual(GITHUB);
    expect(stateChanges()).toBe(1);
  });

  it('uses the token it already has when none is pasted', async () => {
    const fetch = fakeGitHub(['api']);
    const { repositories } = setup(fetch, memorySecrets({ acme: { GITHUB_TOKEN: 'ghp_good' } }));
    expect(await repositories.connectGitSource('acme', GITHUB, '   ')).toHaveLength(1);
  });

  it('asks for a token before reaching GitHub', async () => {
    const fetch = fakeGitHub(['api']);
    const { repositories } = setup(fetch);
    await expect(repositories.connectGitSource('acme', GITHUB)).rejects.toThrow('Paste a token so Hatstand can see this client\'s repositories.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps neither the token nor the source when GitHub rejects the token', async () => {
    const { repositories, secrets, stateChanges } = setup(fakeGitHub(['api']));
    await expect(repositories.connectGitSource('acme', GITHUB, 'ghp_bad')).rejects.toThrow('GitHub rejected this token.');
    expect(secrets.read('acme')).toEqual({});
    expect(home.store.readCompany('acme').gitSource).toBeUndefined();
    expect(stateChanges()).toBe(0);
  });

  it('marks the saved token as rejected when GitHub rejects it, and removes the mark when it works again', async () => {
    const secrets = memorySecrets({ acme: { GITHUB_TOKEN: 'ghp_old' } });
    const state = () => secrets.list('acme')[0]?.check?.result;
    const rejecting = setup(fakeGitHub(['api']), secrets);
    await expect(rejecting.repositories.connectGitSource('acme', GITHUB)).rejects.toThrow('GitHub rejected this token.');
    expect(state()).toBe('rejected');
    expect(rejecting.stateChanges()).toBe(1);

    await setup(fakeGitHub(['api'], 'ghp_old'), secrets).repositories.connectGitSource('acme', GITHUB);
    expect(state()).toBeUndefined();
  });

  it('does not blame the saved token for a pasted one that GitHub rejects', async () => {
    const secrets = memorySecrets({ acme: { GITHUB_TOKEN: 'ghp_good' } });
    await expect(setup(fakeGitHub(['api']), secrets).repositories.connectGitSource('acme', GITHUB, 'ghp_typo')).rejects.toThrow('GitHub rejected this token.');
    expect(secrets.list('acme')[0]?.check).toBeUndefined();
  });

  it('refuses a source it cannot use', async () => {
    const { repositories } = setup(fakeGitHub(['api']));
    await expect(repositories.connectGitSource('acme', { provider: 'github', owner: ' ' }, 'ghp_good')).rejects.toThrow('Write the organization, group or user.');
  });

  it('remembers where a GitLab of its own lives', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input);
      if (url.startsWith('https://gitlab.acme.dev/api/v4/groups/acme?')) return reply(200, {});
      if (url.startsWith('https://gitlab.acme.dev/api/v4/groups/acme/projects?')) return reply(200, [{ path_with_namespace: 'acme/api', http_url_to_repo: 'https://gitlab.acme.dev/acme/api.git' }]);
      return reply(404);
    });
    const { repositories, secrets } = setup(fetch);
    await repositories.connectGitSource('acme', { provider: 'gitlab', owner: 'acme', host: 'gitlab.acme.dev' }, 'glpat');
    expect(secrets.read('acme')).toEqual({ GITLAB_TOKEN: 'glpat', GITLAB_URL: 'https://gitlab.acme.dev' });
  });
});

describe('downloading repositories', () => {
  const connected = () => home.store.saveCompany({ ...home.store.readCompany('acme'), gitSource: GITHUB });
  const withToken = () => memorySecrets({ acme: { GITHUB_TOKEN: 'ghp_good' } });

  it('needs a connected source and a token', async () => {
    await expect(setup().repositories.downloadRepos('acme', home.folder('code'), ['api'])).rejects.toThrow('Connect GitHub or GitLab first.');
    connected();
    await expect(setup().repositories.downloadRepos('acme', home.folder('code'), ['api'])).rejects.toThrow('Paste a token so Hatstand can download this client\'s repositories.');
  });

  it('will not download into Hatstand\'s own data folder', async () => {
    connected();
    const { repositories } = setup(fakeGitHub(['api']), withToken());
    await expect(repositories.downloadRepos('acme', join(home.paths.home, 'code'), ['api'])).rejects.toThrow('Choose a folder outside Hatstand\'s own data folder.');
  });

  it('adds the chosen repositories to the client, reporting each step', async () => {
    connected();
    const { repositories, ctx, emitted } = setup(fakeGitHub(['api', 'web']), withToken());
    const target = checkout(join(ctx.userHome, 'code', 'api'), 'https://github.com/acme/api.git');

    const results = await repositories.downloadRepos('acme', '~/code', ['api']);
    expect(results).toEqual([{ path: 'api', state: 'existing' }]);
    expect(home.store.readCompany('acme')).toMatchObject({ rootDir: join(ctx.userHome, 'code'), projects: [{ name: 'api', path: target }] });
    expect(emitted.filter((item) => item.event === 'clone-progress').map((item) => item.payload)).toEqual([
      { path: 'api', state: 'cloning', companyId: 'acme' },
      { path: 'api', state: 'existing', companyId: 'acme' },
    ]);
  });

  it('leaves a folder that holds another repository alone, and does not add it', async () => {
    connected();
    const { repositories, ctx } = setup(fakeGitHub(['api']), withToken());
    checkout(join(ctx.userHome, 'code', 'api'), 'https://github.com/someone-else/api.git');
    const [result] = await repositories.downloadRepos('acme', '~/code', ['api']);
    expect(result).toMatchObject({ state: 'failed', blocker: 'other-repository', error: expect.stringContaining('already holds a different repository') });
    expect(home.store.readCompany('acme').projects).toEqual([]);
  });

  it.each(['git@github.com:acme/api.git', 'git@github-acme:acme/api.git', 'ssh://git@github.com/Acme/api'])(
    'takes a folder downloaded from %s as the same repository',
    async (origin) => {
      connected();
      const { repositories, ctx } = setup(fakeGitHub(['api']), withToken());
      const target = checkout(join(ctx.userHome, 'code', 'api'), origin);
      expect(await repositories.downloadRepos('acme', '~/code', ['api'])).toEqual([{ path: 'api', state: 'existing' }]);
      expect(home.store.readCompany('acme').projects).toMatchObject([{ name: 'api', path: target }]);
    },
  );

  it('leaves a folder that is not a repository alone, and downloads into an empty one', async () => {
    connected();
    const { repositories, ctx } = setup(fakeGitHub(['api', 'web']), withToken());
    mkdirSync(join(ctx.userHome, 'code', 'api'), { recursive: true });
    writeFileSync(join(ctx.userHome, 'code', 'api', 'notes.txt'), 'mine');
    const [result] = await repositories.downloadRepos('acme', '~/code', ['api']);
    expect(result).toEqual({ path: 'api', state: 'failed', blocker: 'not-a-repository', error: expect.stringMatching(/already exists and is not a repository\.$/) });
    expect(home.store.readCompany('acme').projects).toEqual([]);

    mkdirSync(join(ctx.userHome, 'code', 'web'));
    ctx.tools.path = home.folder('no-git-here');
    const [empty] = await repositories.downloadRepos('acme', '~/code', ['web']);
    expect(empty).toMatchObject({ path: 'web', state: 'failed' });
    expect(empty?.blocker).toBeUndefined();
  });

  it('downloads for one client at a time, and can download again once done', async () => {
    connected();
    let answer = () => {};
    const github = fakeGitHub([]);
    const slow = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input).endsWith('/user')) await new Promise<void>((resolve) => (answer = resolve));
      return github(input, init);
    });
    const { repositories } = setup(slow, withToken());
    const first = repositories.downloadRepos('acme', home.folder('code'), []);
    await vi.waitFor(() => expect(slow).toHaveBeenCalled());
    await expect(repositories.downloadRepos('acme', home.folder('code'), [])).rejects.toThrow('This client is already downloading repositories.');
    answer();
    expect(await first).toEqual([]);
    const again = repositories.downloadRepos('acme', home.folder('code'), []);
    answer();
    expect(await again).toEqual([]);
  });

  it('can download again after a download fails', async () => {
    connected();
    const { repositories } = setup(fakeGitHub(['api'], 'ghp_other'), withToken());
    await expect(repositories.downloadRepos('acme', home.folder('code'), ['api'])).rejects.toThrow('GitHub rejected this token.');
    await expect(repositories.downloadRepos('acme', home.folder('code'), ['api'])).rejects.toThrow('GitHub rejected this token.');
  });
});

describe('downloading one repository from its link', () => {
  const GITLAB: GitSource = { provider: 'gitlab', owner: 'acme', host: 'gitlab.acme.dev' };
  const withToken = () => memorySecrets({ acme: { GITHUB_TOKEN: 'ghp_good' } });

  it('adds the repository to the client, with no connection and no token', async () => {
    const { repositories, ctx, emitted, stateChanges } = setup();
    const target = checkout(join(ctx.userHome, 'code', 'api'), 'https://github.com/acme/api.git');

    expect(await repositories.downloadRepoByLink('acme', 'git@github.com:acme/api.git', '~/code')).toEqual({ path: 'api', state: 'existing' });
    expect(home.store.readCompany('acme')).toMatchObject({ rootDir: join(ctx.userHome, 'code'), projects: [{ name: 'api', path: target }] });
    expect(stateChanges()).toBe(1);
    expect(emitted.filter((item) => item.event === 'clone-progress').map((item) => item.payload)).toEqual([
      { path: 'api', state: 'cloning', companyId: 'acme' },
      { path: 'api', state: 'existing', companyId: 'acme' },
    ]);
  });

  it('takes a repository of another owner on the site of the client', async () => {
    home.store.saveCompany({ ...home.store.readCompany('acme'), gitSource: GITLAB });
    const { repositories, ctx } = setup(undefined, memorySecrets({ acme: { GITLAB_TOKEN: 'glpat' } }));
    checkout(join(ctx.userHome, 'code', 'tools'), 'https://gitlab.acme.dev/partner/shared/tools.git');
    const result = await repositories.downloadRepoByLink('acme', 'https://gitlab.acme.dev/partner/shared/tools', '~/code');
    expect(result).toEqual({ path: 'tools', state: 'existing' });
  });

  it('refuses a link on another site before it prepares a folder or runs git', async () => {
    home.store.saveCompany({ ...home.store.readCompany('acme'), gitSource: GITLAB });
    const { repositories, ctx, emitted } = setup(undefined, memorySecrets({ acme: { GITLAB_TOKEN: 'glpat' } }));
    await expect(repositories.downloadRepoByLink('acme', 'https://github.com/acme/api', '~/code')).rejects.toThrow('this link is on another site');
    expect(existsSync(join(ctx.userHome, 'code'))).toBe(false);
    expect(emitted).toEqual([]);
  });

  it('will not download into a repository or into Hatstand\'s own data folder', async () => {
    const { repositories } = setup();
    const repo = makeGitRepo(home.folder('code', 'mono'));
    await expect(repositories.downloadRepoByLink('acme', 'https://github.com/acme/api', repo)).rejects.toThrow('Choose a folder outside any repository.');
    await expect(repositories.downloadRepoByLink('acme', 'https://github.com/acme/api', join(home.paths.home, 'code'))).rejects.toThrow('Choose a folder outside Hatstand\'s own data folder.');
  });

  it('leaves a folder that holds another repository alone, and does not add it', async () => {
    const { repositories, ctx } = setup(undefined, withToken());
    checkout(join(ctx.userHome, 'code', 'api'), 'https://github.com/someone-else/api.git');
    const result = await repositories.downloadRepoByLink('acme', 'https://github.com/acme/api', '~/code');
    expect(result).toEqual({ path: 'api', state: 'failed', blocker: 'other-repository', error: expect.stringMatching(/already holds a different repository\.$/) });
    expect(home.store.readCompany('acme').projects).toEqual([]);
  });

  it('says where to put a token when a download without one fails', async () => {
    const { repositories, ctx } = setup();
    ctx.tools.path = home.folder('no-git-here');
    const result = await repositories.downloadRepoByLink('acme', 'https://github.com/acme/private', home.folder('code'));
    expect(result).toMatchObject({ state: 'failed', error: expect.stringContaining('If the repository is private, add GITHUB_TOKEN to this client\'s keys.') });
  });

  it('waits for the download of the list of the same client', async () => {
    home.store.saveCompany({ ...home.store.readCompany('acme'), gitSource: GITHUB });
    let answer = () => {};
    const github = fakeGitHub([]);
    const slow = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input).endsWith('/user')) await new Promise<void>((resolve) => (answer = resolve));
      return github(input, init);
    });
    const { repositories, ctx } = setup(slow, withToken());
    checkout(join(ctx.userHome, 'code', 'api'), 'https://github.com/acme/api.git');
    const list = repositories.downloadRepos('acme', '~/code', []);
    await vi.waitFor(() => expect(slow).toHaveBeenCalled());
    await expect(repositories.downloadRepoByLink('acme', 'https://github.com/acme/api', '~/code')).rejects.toThrow('This client is already downloading repositories.');
    answer();
    await list;
    expect(await repositories.downloadRepoByLink('acme', 'https://github.com/acme/api', '~/code')).toMatchObject({ state: 'existing' });
  });
});

describe('finding repositories on this computer', () => {
  it('reads the layout of a monorepo of the client', async () => {
    const repo = makeGitRepo(home.folder('code', 'mono'));
    writeFileSync(join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    ['web', 'api'].forEach((app) => mkdirSync(join(repo, 'apps', app), { recursive: true }));
    home.store.saveCompany({ ...home.store.readCompany('acme'), projects: [{ id: 'mono', name: 'mono', path: repo }] });
    const { repositories } = setup();
    expect(await repositories.inspectRepoLayout('acme', 'mono')).toEqual({ tool: 'pnpm workspace', isMonorepo: true, folders: ['apps/api', 'apps/web'] });
    await expect(repositories.inspectRepoLayout('acme', 'gone')).rejects.toThrow('This repository is no longer part of this client.');
  });

  it('finds the repositories in a folder, and tells a folder inside one', async () => {
    makeGitRepo(home.folder('code', 'api'));
    makeGitRepo(home.folder('code', 'group', 'web'));
    const { repositories } = setup();
    expect((await repositories.scanRepos(home.folder('code'))).map((repo) => repo.name)).toEqual(['api', 'web']);
    expect(await repositories.isInsideGitRepo(home.folder('code', 'api', 'src'))).toBe(true);
    expect(await repositories.isInsideGitRepo(home.folder('elsewhere'))).toBe(false);
  });

  it('reads ~ as the home folder, and says when a path does not exist', async () => {
    const { repositories, ctx } = setup();
    mkdirSync(join(ctx.userHome, 'docs'));
    expect(await repositories.resolvePath('~/docs', 'directory')).toBe(join(ctx.userHome, 'docs'));
    await expect(repositories.resolvePath('~/missing', 'directory')).rejects.toThrow(`${join(ctx.userHome, 'missing')} does not exist.`);
  });
});

describe('a folder that stops a download', () => {
  const GIT = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com'];
  const withToken = () => memorySecrets({ acme: { GITHUB_TOKEN: 'ghp_good' } });

  /** A download from a link that finds another repository in its folder, with work that is only on this computer. */
  async function blockedDownload() {
    const parts = setup(undefined, withToken());
    const target = checkout(join(parts.ctx.userHome, 'code', 'api'), 'https://github.com/someone-else/api.git');
    writeFileSync(join(target, 'README.md'), 'hello');
    execFileSync('git', ['add', '.'], { cwd: target });
    execFileSync('git', [...GIT, 'commit', '-qm', 'first'], { cwd: target });
    writeFileSync(join(target, 'draft.md'), 'not committed');
    await parts.repositories.downloadRepoByLink('acme', 'https://github.com/acme/api', '~/code');
    return { ...parts, target };
  }

  it('says what is in it, and what is only on this computer', async () => {
    const { repositories, target } = await blockedDownload();
    expect(await repositories.inspectBlockedFolder('acme', '~/code', 'api')).toEqual({
      target,
      blocker: 'other-repository',
      origin: 'https://github.com/someone-else/api.git',
      entries: 0,
      uncommitted: 1,
      unpushed: 1,
    });
  });

  it('counts what is in a folder that is not a repository', async () => {
    const { repositories, ctx } = setup(undefined, withToken());
    const target = join(ctx.userHome, 'code', 'api');
    mkdirSync(join(target, 'src'), { recursive: true });
    writeFileSync(join(target, 'notes.txt'), 'mine');
    await repositories.downloadRepoByLink('acme', 'https://github.com/acme/api', '~/code');
    expect(await repositories.inspectBlockedFolder('acme', '~/code', 'api')).toEqual({ target, blocker: 'not-a-repository', entries: 2, uncommitted: 0, unpushed: 0 });
  });

  it('moves it to the trash once its name is typed, and nothing else', async () => {
    const { repositories, ctx, target } = await blockedDownload();
    mkdirSync(join(ctx.userHome, 'code', 'web'));
    await repositories.trashBlockedFolder('acme', '~/code', 'api', ' api ');
    expect(existsSync(target)).toBe(false);
    expect(existsSync(join(home.folder('trash'), '0-api', 'draft.md'))).toBe(true);
    expect(existsSync(join(ctx.userHome, 'code', 'web'))).toBe(true);
    await expect(repositories.trashBlockedFolder('acme', '~/code', 'api', 'api')).rejects.toThrow('Download this repository again');
  });

  it('keeps the folder when the name typed is not the one of the repository', async () => {
    const { repositories, target } = await blockedDownload();
    await expect(repositories.trashBlockedFolder('acme', '~/code', 'api', 'API')).rejects.toThrow('Type api to confirm.');
    await expect(repositories.trashBlockedFolder('acme', '~/code', 'api', '')).rejects.toThrow('Type api to confirm.');
    expect(existsSync(target)).toBe(true);
  });

  it('only touches a folder that a download of this client found taken', async () => {
    const { repositories, ctx } = await blockedDownload();
    const other = checkout(join(ctx.userHome, 'code', 'web'), 'https://github.com/someone-else/web.git');
    const outside = makeGitRepo(join(ctx.userHome, 'elsewhere'));
    await expect(repositories.trashBlockedFolder('acme', '~/code', 'web', 'web')).rejects.toThrow('Download this repository again');
    await expect(repositories.trashBlockedFolder('acme', '~/code', '../elsewhere', 'elsewhere')).rejects.toThrow('Download this repository again');
    await expect(repositories.trashBlockedFolder('acme', '~', 'api', 'api')).rejects.toThrow('Download this repository again');
    await expect(repositories.inspectBlockedFolder('acme', '~/code', 'web')).rejects.toThrow('Download this repository again');
    home.store.createCompany('Other', '#445566');
    await expect(repositories.trashBlockedFolder('other', '~/code', 'api', 'api')).rejects.toThrow('Download this repository again');
    expect([other, outside].every((folder) => existsSync(folder))).toBe(true);
  });

  it('keeps a folder that became the repository asked for', async () => {
    const { repositories, target } = await blockedDownload();
    execFileSync('git', ['remote', 'set-url', 'origin', 'git@github.com:acme/api.git'], { cwd: target });
    await expect(repositories.trashBlockedFolder('acme', '~/code', 'api', 'api')).rejects.toThrow('no longer stops the download');
    expect(existsSync(target)).toBe(true);
  });

  it('keeps a folder that a client works in, or that holds one', async () => {
    const { repositories, target } = await blockedDownload();
    home.store.createCompany('Other', '#445566');
    home.store.saveCompany({ ...home.store.readCompany('other'), projects: [{ id: 'api', name: 'api', path: target }] });
    await expect(repositories.trashBlockedFolder('acme', '~/code', 'api', 'api')).rejects.toThrow('Other uses');
    home.store.saveCompany({ ...home.store.readCompany('other'), projects: [{ id: 'inner', name: 'inner', path: join(target, 'packages', 'inner') }] });
    await expect(repositories.trashBlockedFolder('acme', '~/code', 'api', 'api')).rejects.toThrow('Other uses');
    expect(existsSync(target)).toBe(true);
  });

  it('says so when the trash fails, and keeps the folder', async () => {
    const { ctx, target } = await blockedDownload();
    const withoutTrash = createRepositoryService({
      ...ctx,
      trash: async () => {
        throw new Error('No trash on this computer.');
      },
    });
    await withoutTrash.downloadRepoByLink('acme', 'https://github.com/acme/api', '~/code');
    await expect(withoutTrash.trashBlockedFolder('acme', '~/code', 'api', 'api')).rejects.toThrow('nothing was deleted. No trash on this computer.');
    expect(existsSync(target)).toBe(true);
  });

  it('downloads again once the folder is in the trash', async () => {
    const { repositories, ctx } = await blockedDownload();
    await repositories.trashBlockedFolder('acme', '~/code', 'api', 'api');
    ctx.tools.path = home.folder('no-git-here');
    const result = await repositories.downloadRepoByLink('acme', 'https://github.com/acme/api', '~/code');
    expect(result.blocker).toBeUndefined();
  });
});
