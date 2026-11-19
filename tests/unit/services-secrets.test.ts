import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSecretService } from '../../src/main/services/secrets';
import { makeHome, type TestHome } from '../helpers/home';
import { makeServiceContext, memorySecrets, reply } from '../helpers/services';

let home: TestHome;
beforeEach(() => {
  home = makeHome('hatstand-secret-services-');
});
afterEach(() => home.remove());

function setup(fetch?: typeof globalThis.fetch, acme: Record<string, string> = { API_KEY: 'k' }) {
  const secrets = memorySecrets({ acme, globex: { OTHER: 'o' } });
  const { ctx, stateChanges } = makeServiceContext(home, secrets, fetch);
  return { service: createSecretService(ctx), secrets, stateChanges };
}

describe('the secrets of a client', () => {
  it('lists the names only, never the values', async () => {
    expect(await setup().service.listSecretNames('acme')).toEqual(['API_KEY']);
  });

  it('adds and replaces a secret, for that client only', async () => {
    const { service, secrets, stateChanges } = setup();
    await service.setSecret('acme', 'DB_URL', 'postgres://x');
    await service.setSecret('acme', 'API_KEY', 'new');
    expect(secrets.read('acme')).toEqual({ API_KEY: 'new', DB_URL: 'postgres://x' });
    expect(secrets.read('globex')).toEqual({ OTHER: 'o' });
    expect(stateChanges()).toBe(2);
  });

  it.each(['1ST', 'MY-KEY', 'MY KEY', ''])('refuses %j as a name, and saves nothing', async (name) => {
    const { service, secrets, stateChanges } = setup();
    await expect(service.setSecret('acme', name, 'x')).rejects.toThrow();
    expect(secrets.read('acme')).toEqual({ API_KEY: 'k' });
    expect(stateChanges()).toBe(0);
  });

  it('deletes a secret', async () => {
    const { service, secrets, stateChanges } = setup();
    await service.deleteSecret('acme', 'API_KEY');
    expect(secrets.read('acme')).toEqual({});
    expect(stateChanges()).toBe(1);
  });
});

describe('what Hatstand knows about the keys of a client', () => {
  const gitHub = (status: number) => async () =>
    new Response('{}', { status, headers: { 'GitHub-Authentication-Token-Expiration': '2026-12-01 08:00:00 UTC' } });

  it('lists each key with its details, never its value', async () => {
    const { service } = setup();
    await service.setKeyNote('acme', 'API_KEY', 'Billing sandbox');
    const keys = await service.listKeys('acme');
    expect(keys).toEqual([{ name: 'API_KEY', note: 'Billing sandbox', check: undefined }]);
    expect(JSON.stringify(keys)).not.toContain('"k"');
  });

  it('checks a key with its provider, and remembers the answer and the expiry', async () => {
    const { service, stateChanges } = setup(gitHub(200), { GITHUB_TOKEN: 'ghp_1' });
    await service.checkKey('acme', 'GITHUB_TOKEN');
    expect((await service.listKeys('acme'))[0]?.check).toMatchObject({ result: 'valid', expiresAt: '2026-12-01T08:00:00.000Z' });
    expect(stateChanges()).toBe(1);
  });

  it('remembers that the provider rejected a key', async () => {
    const { service } = setup(gitHub(401), { GITHUB_TOKEN: 'ghp_1' });
    await service.checkKey('acme', 'GITHUB_TOKEN');
    expect((await service.listKeys('acme'))[0]?.check?.result).toBe('rejected');
  });

  it('remembers nothing when the provider could not be asked', async () => {
    const { service, stateChanges } = setup(async () => reply(503), { GITHUB_TOKEN: 'ghp_1' });
    await expect(service.checkKey('acme', 'GITHUB_TOKEN')).rejects.toThrow('GitHub answered 503');
    expect((await service.listKeys('acme'))[0]?.check).toBeUndefined();
    expect(stateChanges()).toBe(0);
  });

  it('never reaches the network for a key with no provider', async () => {
    await expect(setup().service.checkKey('acme', 'API_KEY')).rejects.toThrow('no provider');
  });
});
