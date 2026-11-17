import { existsSync } from 'node:fs';
import type { HatstandApi } from '../../shared/api';
import { activeFolder, countFolderFiles, looksLikePlugin } from '../active-folders';
import { createDocument, listClientFiles, readClientFile } from '../client-files';
import type { ServiceContext } from './context';
import type { RepoProtection } from './guard';

export type ClientFileService = Pick<HatstandApi, 'listClientFiles' | 'readClientFile' | 'createDocument' | 'folderSwitchImpact' | 'listPastFolders' | 'isPluginFolder'>;

export function createClientFileService({ store, paths, emit }: Pick<ServiceContext, 'store' | 'paths' | 'emit'>, { protection }: { protection: Pick<RepoProtection, 'refreshFingerprints'> }): ClientFileService {
  return {
    listClientFiles: async (companyId) => listClientFiles(paths, store.readCompany(companyId)),
    readClientFile: async (companyId, path) => readClientFile(paths, store.readCompany(companyId), path),
    createDocument: async (companyId, where, name) => {
      const company = store.readCompany(companyId);
      const file = createDocument(paths, company, where, name);
      protection.refreshFingerprints(company);
      emit('state-changed', null);
      return file;
    },
    folderSwitchImpact: async (companyId, section) => {
      const from = activeFolder(paths, store.readCompany(companyId), section);
      const openTasks = store.listTasks(companyId).filter((task) => (task.status === 'todo' || task.status === 'doing') && !task.archivedAt).length;
      return { from, files: countFolderFiles(from), openTasks };
    },
    listPastFolders: async (companyId, section) =>
      (store.readCompany(companyId).pastFolders ?? [])
        .filter((folder) => folder.section === section)
        .map(({ path, leftAt }) => ({ path, leftAt, exists: existsSync(path) })),
    isPluginFolder: async (path) => looksLikePlugin(path),
  };
}
