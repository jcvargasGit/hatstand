import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionEnv } from '../../src/main/session-env';
import type { Company } from '../../src/shared/schemas';
import { makeHome, type TestHome } from '../helpers/home';
import { fakeProtection } from '../helpers/sessions';

let home: TestHome;
let company: Company;
beforeEach(() => {
  home = makeHome('hatstand-session-env-');
  company = home.store.saveCompany({ ...home.store.createCompany('Acme', '#112233'), gitSource: { provider: 'github', owner: 'acme' }, gitIdentity: { name: 'Ana', email: 'ana@acme.dev', folder: '/code/acme' } });
});
afterEach(() => home.remove());

const secrets = { read: (companyId: string): Record<string, string> => (companyId === 'acme' ? { GITHUB_TOKEN: 'ghp_x', API_KEY: 'k' } : {}) };
const build = (env: SessionEnv, input: Partial<Parameters<SessionEnv['build']>[0]> = {}) =>
  env.build({ company, adapter: {}, before: {}, launchEnv: {}, after: {}, ...input });

describe('the environment of an agent', () => {
  it('refreshes the commit check with the saved client, through the protection it was given', () => {
    const protection = fakeProtection();
    build(new SessionEnv(home.paths, home.store, secrets, '/usr/bin', protection), { company: { ...company, projects: [{ id: 'copy', name: 'copy', path: '/copy' }] } });
    expect(protection.refreshFingerprints).toHaveBeenCalledExactlyOnceWith(home.store.readCompany('acme'));
  });

  it('does not start without it', () => {
    const protection = fakeProtection();
    vi.mocked(protection.refreshFingerprints).mockImplementation(() => {
      throw new Error('The keychain is locked.');
    });
    expect(() => build(new SessionEnv(home.paths, home.store, secrets, '/usr/bin', protection))).toThrow('The keychain is locked.');
  });

  it('puts the Hatstand tools first on the PATH, with the secrets, credentials and identity of the client', () => {
    const env = build(new SessionEnv(home.paths, home.store, secrets, '/usr/bin', fakeProtection()));
    expect(env.PATH).toBe(`${home.paths.toolsDir}:/usr/bin`);
    expect(env).toMatchObject({ API_KEY: 'k', GITHUB_TOKEN: 'ghp_x', GIT_AUTHOR_EMAIL: 'ana@acme.dev' });
    expect(Object.values(env).join('\n')).toContain('credential.https://github.com.helper');
  });

  it('leaves out the secrets the agent must not see', () => {
    const env = build(new SessionEnv(home.paths, home.store, secrets, '/usr/bin', fakeProtection()), { adapter: { hiddenSecrets: ['GITHUB_TOKEN'] } });
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.API_KEY).toBe('k');
  });

  it('lets the agent adapter replace what the modules give before it, never what they give after it', () => {
    const env = build(new SessionEnv(home.paths, home.store, secrets, '/usr/bin', fakeProtection()), {
      before: { EARLY: 'module', BOTH: 'module' },
      launchEnv: { EARLY: 'adapter', BOTH: 'adapter', LATE: 'adapter' },
      after: { BOTH: 'module', LATE: 'module' },
    });
    expect(env).toMatchObject({ EARLY: 'adapter', BOTH: 'module', LATE: 'module' });
  });
});
