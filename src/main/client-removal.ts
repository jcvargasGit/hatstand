import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ClientRemovalReport } from '../shared/api';
import { uninstallPreCommitHook } from './guard/install';
import { clientRepoFolders, guardRepos } from './guard/service';
import type { DataPaths } from './paths';
import type { Store } from './store';

const timestamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

export function removeClient(store: Store, paths: DataPaths, companyId: string, deleteFiles: boolean, now = new Date()): ClientRemovalReport {
  const company = store.readCompany(companyId);
  if (!company.archivedAt) throw new Error('Archive this client before removing it.');
  if (basename(company.id) !== company.id) throw new Error('This client has an unsafe folder name.');

  const otherRepos = new Set(
    store
      .listCompanies()
      .filter((other) => other.id !== company.id)
      .flatMap((other) => guardRepos(other).map((repo) => repo.path)),
  );
  const repoPaths = clientRepoFolders(company);
  const kept = join(paths.removedDir, `${company.id}-${timestamp(now)}`);
  if (!deleteFiles && existsSync(kept)) throw new Error(`${kept} already exists. Try again in a moment.`);

  const protectionKept = repoPaths.filter((path) => otherRepos.has(path));
  const protectionRemoved = repoPaths.filter((path) => !otherRepos.has(path) && uninstallPreCommitHook(path));

  store.deleteSessionsOfCompany(company.id);
  store.removeAccountsOfCompany(company.id);
  rmSync(paths.secretsFile(company.id), { force: true });

  const folder = paths.company(company.id);
  if (deleteFiles) {
    rmSync(paths.guardFingerprints(company.id), { force: true });
    rmSync(folder, { recursive: true, force: true });
    return { protectionRemoved, protectionKept };
  }

  mkdirSync(paths.removedDir, { recursive: true, mode: 0o700 });
  renameSync(folder, kept);
  return { keptFilesIn: kept, protectionRemoved, protectionKept };
}
