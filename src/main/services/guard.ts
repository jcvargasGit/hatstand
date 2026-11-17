import type { HatstandApi } from '../../shared/api';
import type { Company } from '../../shared/schemas';
import { guardStatus, installGuard, refreshFingerprints, removeControlRepoHooks } from '../guard/service';
import type { ServiceContext } from './context';

/** The commit protection other services keep up to date when they change what a client owns. */
export type RepoProtection = {
  /** Takes the commit check out of the control repositories of a client that no other client works in. */
  clearControlRepoHooks(company: Company): string[];
  /** Lets the commit check know the latest knowledge and secrets of a client. */
  refreshFingerprints(company: Company): void;
  /** refreshFingerprints for every client. One client failing does not stop the others. */
  refreshAllFingerprints(): void;
};

export function createRepoProtection({ store, paths, secrets }: Pick<ServiceContext, 'store' | 'paths' | 'secrets'>): RepoProtection {
  const refresh = (company: Company) => refreshFingerprints(paths, company, secrets.read(company.id));
  return {
    clearControlRepoHooks: (company) => removeControlRepoHooks(company, store.listCompanies().filter((other) => other.id !== company.id)),
    refreshFingerprints: refresh,
    refreshAllFingerprints: () => {
      for (const company of store.listCompanies()) {
        try {
          refresh(company);
        } catch (error) {
          console.error(`Commit protection could not be updated for ${company.id}.`, error);
        }
      }
    },
  };
}

export type GuardService = Pick<HatstandApi, 'guardStatus' | 'installGuard'>;

export function createGuardService({ store, paths, secrets, tools, emit }: ServiceContext, { protection }: { protection: Pick<RepoProtection, 'clearControlRepoHooks'> }): GuardService {
  return {
    guardStatus: async (companyId) => {
      const company = store.readCompany(companyId);
      const status = guardStatus(company);
      const protectedPaths = status.filter((repo) => repo.state === 'protected').map((repo) => repo.path);
      if ([...protectedPaths].sort().join('\n') !== [...company.protectedPaths].sort().join('\n')) {
        store.saveCompany({ ...company, protectedPaths });
        emit('state-changed', null);
      }
      return status;
    },
    installGuard: async (companyId, keepExistingHooks = []) => {
      const company = store.readCompany(companyId);
      protection.clearControlRepoHooks(company);
      const report = installGuard(paths, company, secrets.read(companyId), tools.nodePath, keepExistingHooks);
      store.saveCompany({ ...company, protectedPaths: report.installed });
      emit('state-changed', null);
      return report;
    },
  };
}
