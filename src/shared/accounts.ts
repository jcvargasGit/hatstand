import type { Account } from './schemas';

export function accountsForClient(accounts: Account[], companyId: string): Account[] {
  return accounts.filter((account) => !account.companyId || account.companyId === companyId);
}
