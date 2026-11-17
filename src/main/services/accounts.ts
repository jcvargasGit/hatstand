import { randomUUID } from 'node:crypto';
import type { HatstandApi } from '../../shared/api';
import type { Account } from '../../shared/schemas';
import type { AgentSignIn, checkAgent } from '../agent-status';
import type { ServiceContext } from './context';

export type AccountService = Pick<HatstandApi, 'checkAgent' | 'startAgentSignIn' | 'saveAccount' | 'removeAccount' | 'setDefaultAccount'>;

export type AccountServiceDeps = {
  signIn: Pick<AgentSignIn, 'start'>;
  /** Checks that the agent is installed and signed in. It runs the agent, so it comes from outside, and a test can pass a fake. */
  checkAgent: typeof checkAgent;
};

export function createAccountService({ store, tools }: Pick<ServiceContext, 'store' | 'tools'>, { signIn, checkAgent }: AccountServiceDeps): AccountService {
  const requireAccount = (accountId: string): Account => {
    const account = store.readAccounts().accounts.find((item) => item.id === accountId);
    if (!account) throw new Error('This agent account no longer exists.');
    return account;
  };
  return {
    checkAgent: (accountId) => checkAgent(requireAccount(accountId), tools.path),
    startAgentSignIn: async (accountId) => signIn.start(requireAccount(accountId)),
    saveAccount: async (account) => store.saveAccount(account.id ? account : { ...account, id: randomUUID() }),
    removeAccount: async (accountId) => store.removeAccount(accountId),
    setDefaultAccount: async (accountId) => store.setDefaultAccount(accountId),
  };
}
