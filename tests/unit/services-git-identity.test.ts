import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_COPY_MESSAGE } from '../../src/main/dev-copy';
import { createGitIdentityService } from '../../src/main/services/git-identity';
import { makeGitRepo, makeHome, type TestHome } from '../helpers/home';
import { makeServiceContext } from '../helpers/services';

// git --global follows HOME and GIT_CONFIG_GLOBAL, not the home folder the service is given, so both point at the throwaway home.
// The person's own git settings must come out of every test exactly as they went in.
const realGlobal = join(process.env.HOME ?? '/nonexistent', '.gitconfig');
const realGlobalBefore = existsSync(realGlobal) ? readFileSync(realGlobal, 'utf8') : null;

let home: TestHome;
let userHome: string;
let global: string;
let repo: string;

beforeEach(() => {
  home = makeHome('hatstand-git-identity-services-');
  userHome = home.folder('user');
  global = join(userHome, '.gitconfig');
  writeFileSync(global, '[user]\n\tname = Ana Personal\n\temail = ana@home.dev\n');
  vi.stubEnv('HOME', userHome);
  vi.stubEnv('GIT_CONFIG_GLOBAL', global);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  repo = makeGitRepo(join(userHome, 'code', 'acme', 'api'));
  home.store.saveCompany({ ...home.store.createCompany('Acme', '#112233'), rootDir: join(userHome, 'code', 'acme'), projects: [{ id: 'api', name: 'api', path: repo }] });
});
afterEach(() => {
  vi.unstubAllEnvs();
  home.remove();
  expect(existsSync(realGlobal) ? readFileSync(realGlobal, 'utf8') : null).toBe(realGlobalBefore);
});

function setup() {
  const { ctx, stateChanges } = makeServiceContext(home);
  return { identity: createGitIdentityService(ctx), stateChanges };
}

const work = { name: 'Ana Worker', email: 'ana@acme.dev', githubUser: 'ana-acme', folder: '~/code/acme' };

describe('the commit identity of a client', () => {
  it('suggests the identity git uses now, for the client folder', async () => {
    const status = await setup().identity.gitIdentityStatus('acme');
    expect(status.suggested).toEqual({ name: 'Ana Personal', email: 'ana@home.dev', githubUser: '', folder: '~/code/acme/' });
    expect(status.repos).toEqual([{ name: 'api', path: repo, email: 'ana@home.dev', covered: false, matches: false }]);
  });

  it('shows what it would write, without writing it', async () => {
    const before = readFileSync(global, 'utf8');
    const preview = await setup().identity.previewGitIdentity('acme', work);
    expect(preview).toMatchObject({ folder: '~/code/acme/', file: '~/.gitconfig.d/hatstand-acme', addsRule: true });
    expect(preview.preview).toContain('[includeIf "gitdir:~/code/acme/"]');
    expect(preview.preview).toContain('email = ana@acme.dev');
    expect(readFileSync(global, 'utf8')).toBe(before);
    expect(existsSync(join(userHome, '.gitconfig.d'))).toBe(false);
  });

  it('makes git commit as the client in its folder, keeps a backup, and remembers the identity', async () => {
    const { identity, stateChanges } = setup();
    const status = await identity.applyGitIdentity('acme', work);

    expect(execFileSync('git', ['config', 'user.email'], { cwd: repo, encoding: 'utf8' }).trim()).toBe('ana@acme.dev');
    expect(execFileSync('git', ['config', 'user.email'], { cwd: userHome, encoding: 'utf8' }).trim()).toBe('ana@home.dev');
    expect(status.repos).toEqual([{ name: 'api', path: repo, email: 'ana@acme.dev', covered: true, matches: true }]);
    expect(readdirSync(home.paths.backupsDir).filter((name) => name.startsWith('gitconfig-'))).toHaveLength(1);
    expect(home.store.readCompany('acme').gitIdentity).toMatchObject({ name: 'Ana Worker', email: 'ana@acme.dev', githubUser: 'ana-acme', folder: '~/code/acme/', appliedAt: expect.any(String) });
    expect(stateChanges()).toBe(1);
  });

  it('refuses an identity without an email, and writes nothing', async () => {
    const before = readFileSync(global, 'utf8');
    const { identity, stateChanges } = setup();
    await expect(identity.applyGitIdentity('acme', { ...work, email: 'not an email' })).rejects.toThrow('Write the email for your commits.');
    expect(readFileSync(global, 'utf8')).toBe(before);
    expect(home.store.readCompany('acme').gitIdentity).toBeUndefined();
    expect(stateChanges()).toBe(0);
  });

  it('does not change git settings from the development copy', async () => {
    vi.stubEnv('HATSTAND_DEV_COPY', '1');
    const before = readFileSync(global, 'utf8');
    await expect(setup().identity.applyGitIdentity('acme', work)).rejects.toThrow(DEV_COPY_MESSAGE);
    expect(readFileSync(global, 'utf8')).toBe(before);
  });
});
