import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HatstandApi } from '../../shared/api';
import type { Company } from '../../shared/schemas';
import { DEV_COPY_MESSAGE, isDevCopy } from '../dev-copy';
import { planningConflict, suggestPlanningPlaces, withPlanningRepo } from '../planning';
import { createPlanningRepo, defaultPlanningFolder } from '../planning-repo';
import { listFolders } from '../repo-layout';
import type { ServiceContext } from './context';
import type { RepoProtection } from './guard';

export type PlanningService = Pick<HatstandApi, 'setPlanningRepo' | 'createPlanningRepo' | 'defaultPlanningFolder' | 'listPlanningFolders'>;

export function createPlanningService({ store, paths, tools, emit, userHome }: ServiceContext, { protection }: { protection: Pick<RepoProtection, 'clearControlRepoHooks' | 'refreshFingerprints'> }): PlanningService {
  const savePlanningRepo = (company: Company, path: string) => {
    const saved = store.saveCompany(withPlanningRepo(company, path, suggestPlanningPlaces(listFolders(path))));
    protection.clearControlRepoHooks(saved);
    protection.refreshFingerprints(saved);
    emit('state-changed', null);
  };
  return {
    setPlanningRepo: async (companyId, rawPath) => {
      const company = store.readCompany(companyId);
      const conflict = planningConflict(company, rawPath, paths.home, store.listTasks(companyId));
      if (conflict) throw new Error(conflict);
      savePlanningRepo(company, resolve(rawPath));
    },
    createPlanningRepo: async (companyId, rawPath) => {
      if (isDevCopy()) throw new Error(DEV_COPY_MESSAGE);
      const company = store.readCompany(companyId);
      if (company.planning) throw new Error('This client already has a planning repository.');
      savePlanningRepo(company, await createPlanningRepo(company, rawPath, paths.home, tools.path, userHome));
    },
    defaultPlanningFolder: async (companyId) => defaultPlanningFolder(store.readCompany(companyId), userHome),
    listPlanningFolders: async (companyId) => {
      const path = store.readCompany(companyId).planning?.path;
      return path && existsSync(path) ? listFolders(path) : [];
    },
  };
}
