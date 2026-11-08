import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAuthStatus } from '../../src/main/agent-status';
import { sessionGitEnv } from '../../src/main/git-credentials';
import { listRemoteRepos, safeRelativePath, type Fetcher } from '../../src/main/git-hosts';
import { dataPaths, prepareCloneDir } from '../../src/main/paths';
import { cleanGitError, cloneRepos } from '../../src/main/repo-clone';
import { Store } from '../../src/main/store';
import { gitOrigin } from '../../src/shared/git-source';

const TOKEN = 'client-token-value';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const routes =
  (table: Record<string, Response | (() => Response)>): Fetcher =>
  async (input) => {
    const url = String(input);
    const match = Object.keys(table).find((key) => url.includes(key));
    if (!match) return json({}, 404);
    const entry = table[match];
    return typeof entry === 'function' ? entry() : (entry as Response).clone();
  };

const ghRepo = (name: string, archived = false) => ({
  name,
  description: null,
  clone_url: `https://github.com/acme/${name}.git`,
  archived,
  owner: { login: 'acme' },
});

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-onboarding-')));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('listRemoteRepos', () => {
  const github = { provider: 'github', owner: 'acme' } as const;

  it('reads every page of a GitHub organization', async () => {
    const full = Array.from({ length: 100 }, (_, index) => ghRepo(`repo-${String(index).padStart(3, '0')}`));
    const fetcher = routes({
      '/user': json({ login: 'me' }),
      'repos?type=all&per_page=100&page=1': json(full),
      'repos?type=all&per_page=100&page=2': json([ghRepo('zeta', true)]),
      '/orgs/acme': json({}),
    });
    const repos = await listRemoteRepos(github, TOKEN, fetcher);
    expect(repos).toHaveLength(101);
    expect(repos.at(-1)).toMatchObject({ path: 'zeta', archived: true });
  });

  it('falls back to the signed-in user, including private repositories', async () => {
    const fetcher = routes({
      '/user/repos?affiliation=owner': json([ghRepo('mine'), { ...ghRepo('other'), owner: { login: 'someone' } }]),
      '/user': json({ login: 'ACME' }),
    });
    expect((await listRemoteRepos(github, TOKEN, fetcher)).map((repo) => repo.path)).toEqual(['mine']);
  });

  it('explains a rejected token without repeating it', async () => {
    const error = await listRemoteRepos(github, TOKEN, routes({ '/user': json({}, 401) })).catch((caught: Error) => caught);
    expect((error as Error).message).toMatch(/rejected this token/);
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it('keeps GitLab subgroups as folders', async () => {
    const fetcher = routes({
      '/groups/acme/projects': json([
        {
          path_with_namespace: 'acme/web/portal',
          http_url_to_repo: 'https://gitlab.com/acme/web/portal.git',
        },
      ]),
      '/groups/acme': json({}),
    });
    const [repo] = await listRemoteRepos({ provider: 'gitlab', owner: 'acme' }, TOKEN, fetcher);
    expect(repo?.path).toBe('web/portal');
  });

  it('refuses a clone address on another host, so the token cannot leak there', async () => {
    const fetcher = routes({
      '/groups/acme/projects': json([{ path_with_namespace: 'acme/x', http_url_to_repo: 'https://evil.test/x.git' }]),
      '/groups/acme': json({}),
    });
    await expect(listRemoteRepos({ provider: 'gitlab', owner: 'acme' }, TOKEN, fetcher)).rejects.toThrow(/outside/);
  });

  it.each(['../../etc', 'a/../b', '-upload-pack', '.git', 'a b'])('refuses the unsafe repository name %s', (name) => {
    expect(() => safeRelativePath(name, 'acme')).toThrow(/not safe/);
  });

  it('requires https for GitLab, except on this computer', () => {
    expect(() => gitOrigin({ provider: 'gitlab', host: 'http://gitlab.acme.com' })).toThrow(/https/);
    expect(gitOrigin({ provider: 'gitlab', host: 'gitlab.acme.com' })).toBe('https://gitlab.acme.com');
    expect(gitOrigin({ provider: 'gitlab', host: 'http://127.0.0.1:9000' })).toBe('http://127.0.0.1:9000');
  });
});

describe('session credentials', () => {
  const fill = (host: string, env: Record<string, string>) => {
    const globalConfig = join(dir, 'gitconfig');
    writeFileSync(globalConfig, '[credential]\n\thelper = "!f() { echo username=personal; echo password=personal-account; }; f"\n');
    return execFileSync('git', ['credential', 'fill'], {
      input: `protocol=https\nhost=${host}\n\n`,
      env: { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1', ...env },
    }).toString();
  };

  it('uses the client token on its host instead of the personal login, and leaves other hosts alone', () => {
    const secrets = { GITHUB_TOKEN: TOKEN };
    const env = { ...sessionGitEnv({ provider: 'github', owner: 'acme' }, secrets), ...secrets };
    expect(fill('github.com', env)).toContain(`password=${TOKEN}`);
    expect(fill('gitlab.com', env)).toContain('password=personal-account');
    expect(JSON.stringify(sessionGitEnv({ provider: 'github', owner: 'acme' }, secrets))).not.toContain(TOKEN);
  });

  it('adds nothing without a connection or a token', () => {
    expect(sessionGitEnv(undefined, { GITHUB_TOKEN: TOKEN })).toEqual({});
    expect(sessionGitEnv({ provider: 'github', owner: 'acme' }, {})).toEqual({});
  });
});

describe('cloneRepos', () => {
  const bareRepo = (name: string) => {
    const work = join(dir, `${name}-seed`);
    const bare = join(dir, `${name}.git`);
    mkdirSync(work);
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.dev', ...args], { cwd: work });
    git('init', '-q', '-b', 'main');
    writeFileSync(join(work, 'README.md'), name);
    git('add', '.');
    git('commit', '-qm', 'first');
    execFileSync('git', ['clone', '-q', '--bare', work, bare]);
    return `file://${bare}`;
  };
  const clone = (repos: { path: string; cloneUrl: string }[], baseDir: string) =>
    cloneRepos({
      repos: repos.map((repo) => ({ ...repo, description: '', archived: false })),
      baseDir,
      provider: 'github',
      token: TOKEN,
      path: process.env.PATH ?? '',
      onProgress: () => {},
    });

  it('clones into nested folders, recognizes a repeat, and reports a failure per repository', async () => {
    const base = join(dir, 'client');
    const good = bareRepo('good');
    const first = await clone(
      [
        { path: 'web/portal', cloneUrl: good },
        { path: 'missing', cloneUrl: `file://${join(dir, 'nope.git')}` },
      ],
      base,
    );
    expect(first.find((item) => item.path === 'web/portal')?.state).toBe('cloned');
    expect(first.find((item) => item.path === 'missing')?.state).toBe('failed');
    expect(existsSync(join(base, 'web', 'portal', 'README.md'))).toBe(true);
    expect(readFileSync(join(base, 'web', 'portal', '.git', 'config'), 'utf8')).not.toContain(TOKEN);

    const [again] = await clone([{ path: 'web/portal', cloneUrl: good }], base);
    expect(again?.state).toBe('existing');
    const [other] = await clone([{ path: 'web/portal', cloneUrl: bareRepo('other') }], base);
    expect(other?.state).toBe('failed');
    expect(other?.error).toMatch(/different repository/);
  });

  it('removes the token from git errors', () => {
    expect(cleanGitError(`fatal: could not read\nfatal: bad https://x:${TOKEN}@host/`, TOKEN)).toBe('fatal: bad https://x:***@host/');
  });
});

describe('prepareCloneDir', () => {
  it('creates the folder and expands the home shortcut', () => {
    const made = prepareCloneDir('~/projects/acme', join(dir, 'data'), dir);
    expect(made).toBe(join(dir, 'projects', 'acme'));
    expect(existsSync(made)).toBe(true);
  });

  it('refuses a folder inside a repository or inside Hatstand data', () => {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    expect(() => prepareCloneDir(join(dir, 'inside'), join(tmpdir(), 'other'), dir)).toThrow(/inside the git repository/);
    const clean = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-clean-')));
    expect(() => prepareCloneDir(join(clean, 'data', 'x'), join(clean, 'data'), clean)).toThrow(/data folder/);
    rmSync(clean, { recursive: true, force: true });
  });
});

describe('starting from scratch', () => {
  it('creates starter files that do not count as finished work until edited', () => {
    const paths = dataPaths(join(dir, 'home'));
    const store = new Store(paths);
    const company = store.createCompany('Acme', '#112233', 'scratch');
    expect(company.origin).toBe('scratch');
    expect(company.context.instructionsFile).toBe(paths.instructionsFile('acme'));
    expect(existsSync(join(paths.knowledgeDir('acme'), 'README.md'))).toBe(true);
    expect(store.snapshot().starterInstructions).toEqual(['acme']);
    expect(store.snapshot().localKnowledge).toEqual([]);

    writeFileSync(paths.instructionsFile('acme'), 'Always run the upload tests.');
    expect(store.snapshot().starterInstructions).toEqual([]);
  });

  it('adds no starter files for a client with existing folders', () => {
    const paths = dataPaths(join(dir, 'home'));
    const company = new Store(paths).createCompany('Acme', '#112233');
    expect(company.context.instructionsFile).toBeUndefined();
    expect(existsSync(paths.instructionsFile('acme'))).toBe(false);
  });

  it('adds a cloned repository once and keeps the first main folder', () => {
    const store = new Store(dataPaths(join(dir, 'home')));
    store.createCompany('Acme', '#112233', 'scratch');
    store.addClonedProject('acme', '/base', 'web/portal', '/base/web/portal');
    store.addClonedProject('acme', '/other', 'web/portal', '/base/web/portal');
    const company = store.readCompany('acme');
    expect(company.rootDir).toBe('/base');
    expect(company.projects.map((project) => project.name)).toEqual(['web/portal']);
  });
});

describe('parseAuthStatus', () => {
  it('reads the signed-in state, and treats unreadable output as signed out', () => {
    expect(parseAuthStatus('{"loggedIn":true,"email":"a@b.c","subscriptionType":"max"}')).toEqual({ signedIn: true, email: 'a@b.c', plan: 'max' });
    expect(parseAuthStatus('{"loggedIn":false,"email":null}').signedIn).toBe(false);
    expect(parseAuthStatus('not json').signedIn).toBe(false);
  });
});
