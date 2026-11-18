import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSecretService } from '../../src/main/services/secrets';
import { makeHome, type TestHome } from '../helpers/home';
import { makeServiceContext, memorySecrets } from '../helpers/services';

let home: TestHome;
beforeEach(() => {
  home = makeHome('hatstand-secret-services-');
});
afterEach(() => home.remove());

function setup() {
  const secrets = memorySecrets({ acme: { API_KEY: 'k' }, globex: { OTHER: 'o' } });
  const { ctx, stateChanges } = makeServiceContext(home, secrets);
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
