import { existsSync } from 'node:fs';
import { migrateClientFolders } from '../area-migration';
import { buildGuardScript } from '../guard/hook-script';
import { writePrivateFile } from '../store';
import type { ServiceContext } from './context';
import type { RepoProtection } from './guard';

/**
 * Brings the data folder up to date before the first window opens: no session is running yet,
 * client folders follow the current layout, and the commit check runs the current script.
 */
export function prepareWorkspace({ store, paths }: Pick<ServiceContext, 'store' | 'paths'>, { protection }: { protection: Pick<RepoProtection, 'clearControlRepoHooks'> }): void {
  store.markAllSessionsStopped();
  const unmigrated = new Set<string>();
  store.listCompanies().forEach((company) => {
    try {
      const report = migrateClientFolders(store, paths, company.id);
      if (report.backup) console.info(`Hatstand updated the folders of ${company.id}. Backup: ${report.backup}`);
    } catch (error) {
      unmigrated.add(company.id);
      console.error(`Hatstand could not update the folders of ${company.id}:`, error);
    }
  });
  store.listCompanies().forEach((company) => {
    store.ensureClientFolders(company.id);
    if (!unmigrated.has(company.id)) store.ensureAreaFolders(company);
    store.syncFolderPointers(company);
  });
  store.listCompanies().forEach((company) => protection.clearControlRepoHooks(company));
  if (existsSync(paths.guardScript)) writePrivateFile(paths.guardScript, buildGuardScript());
}
