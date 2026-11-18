import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAccountService } from '../../src/main/services/accounts';
import type { Account } from '../../src/shared/schemas';
import { makeHome, type TestHome } from '../helpers/home';
import { fakeServiceDeps, makeServiceContext } from '../helpers/services';

const claude: Account = { id: 'claude', name: 'Claude', type: 'claude-code', label: 'personal' };
const copilot: Account = { id: 'copilot', name: 'Copilot', type: 'github-copilot', label: 'company' };

let home: TestHome;
beforeEach(() => {
  home = makeHome('hatstand-account-services-');
  home.store.createCompany('Acme', '#112233');
  // A new install has an account of its own. Start from only this one.
  home.store.saveAccount(claude);
  home.store.removeAccount('claude-default');
});
afterEach(() => home.remove());

function setup() {
  const { ctx } = makeServiceContext(home);
  const deps = fakeServiceDeps();
  return { accounts: createAccountService(ctx, deps), deps, ctx };
}

describe('checking an agent account', () => {
  it('checks the saved account, on the PATH of the shell', async () => {
    const { accounts, deps, ctx } = setup();
    expect(await accounts.checkAgent('claude')).toEqual({ installed: true, signedIn: true });
    expect(deps.checkAgent).toHaveBeenCalledExactlyOnceWith(claude, ctx.tools.path);
  });

  it('fails at once for an account that no longer exists, without running the agent', () => {
    const { accounts, deps } = setup();
    expect(() => accounts.checkAgent('gone')).toThrow('This agent account no longer exists.');
    expect(deps.checkAgent).not.toHaveBeenCalled();
  });

  it('signs in with the saved account, and only with one that exists', async () => {
    const { accounts, deps } = setup();
    expect(await accounts.startAgentSignIn('claude')).toBe('sign-in');
    expect(deps.signIn.start).toHaveBeenCalledExactlyOnceWith(claude);
    await expect(accounts.startAgentSignIn('gone')).rejects.toThrow('This agent account no longer exists.');
    expect(deps.signIn.start).toHaveBeenCalledOnce();
  });
});

describe('saving agent accounts', () => {
  it('gives a new account an id, and keeps the id of one being changed', async () => {
    const { accounts } = setup();
    await accounts.saveAccount({ ...copilot, id: '' });
    await accounts.saveAccount({ ...claude, name: 'Claude at work' });
    const saved = home.store.readAccounts().accounts;
    expect(saved).toHaveLength(2);
    expect(saved.find((item) => item.type === 'github-copilot')?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved.find((item) => item.id === 'claude')?.name).toBe('Claude at work');
  });

  it('makes an account the default, but not one that belongs to one client', async () => {
    const { accounts } = setup();
    await accounts.saveAccount(copilot);
    await accounts.setDefaultAccount('copilot');
    expect(home.store.readAccounts().defaultAccountId).toBe('copilot');
    await accounts.saveAccount({ ...copilot, id: 'only-acme', companyId: 'acme' });
    await expect(accounts.setDefaultAccount('only-acme')).rejects.toThrow('An account for one client cannot be the default for every client.');
    expect(home.store.readAccounts().defaultAccountId).toBe('copilot');
  });

  it('removes an account, but keeps one that every client can use', async () => {
    const { accounts } = setup();
    await accounts.saveAccount(copilot);
    await accounts.removeAccount('copilot');
    expect(home.store.readAccounts().accounts.map((item) => item.id)).toEqual(['claude']);
    await expect(accounts.removeAccount('claude')).rejects.toThrow('Keep at least one agent account that every client can use.');
  });
});
