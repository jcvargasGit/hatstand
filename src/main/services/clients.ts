import { existsSync } from 'node:fs';
import type { HatstandApi } from '../../shared/api';
import { removeClient } from '../client-removal';
import { openClientWorkspace } from '../editor';
import { prepareCloneDir } from '../paths';
import { downloadPhoto } from '../photos';
import type { SessionManager } from '../sessions';
import { defaultClientFolder } from '../task-folders';
import type { CodeCopies } from './code-copies';
import type { ServiceContext } from './context';

export type ClientService = Pick<
  HatstandApi,
  | 'createCompany'
  | 'saveCompany'
  | 'setClientPhoto'
  | 'removeClientPhoto'
  | 'readClientPhoto'
  | 'resetClientFolder'
  | 'archiveClient'
  | 'restoreClient'
  | 'removeClient'
  | 'openClientInEditor'
  | 'createArea'
  | 'deleteArea'
>;

export type ClientServiceDeps = {
  sessions: Pick<SessionManager, 'hasLiveClientSession'>;
  copies: CodeCopies;
};

export function createClientService({ store, paths, tools, emit, userHome, fetch }: ServiceContext, { sessions, copies }: ClientServiceDeps): ClientService {
  return {
    createCompany: async (name, color, origin) => store.createCompany(name, color, origin),
    saveCompany: async (company) => store.saveCompany(company),
    setClientPhoto: async (companyId, link) => store.saveCompanyPhoto(companyId, link, await downloadPhoto(link, fetch)),
    removeClientPhoto: async (companyId) => store.removeCompanyPhoto(companyId),
    readClientPhoto: async (companyId) => store.readCompanyPhoto(companyId),
    resetClientFolder: async (companyId) => {
      const company = store.readCompany(companyId);
      const target = defaultClientFolder(company, userHome);
      store.saveCompany({ ...company, rootDir: existsSync(target) ? target : prepareCloneDir(target, paths.home, userHome) });
      emit('state-changed', null);
    },
    archiveClient: async (companyId) => {
      if (sessions.hasLiveClientSession(companyId)) throw new Error('Stop this client\'s sessions before archiving it.');
      store.saveCompany({ ...store.readCompany(companyId), archivedAt: new Date().toISOString() });
      emit('state-changed', null);
    },
    restoreClient: async (companyId) => {
      store.saveCompany({ ...store.readCompany(companyId), archivedAt: undefined });
      emit('state-changed', null);
    },
    removeClient: async (companyId, deleteFiles) => {
      if (sessions.hasLiveClientSession(companyId)) throw new Error('Stop this client\'s sessions before removing it.');
      for (const task of store.listTasks(companyId)) await copies.removeCopies(task.id, true);
      const report = removeClient(store, paths, companyId, deleteFiles);
      emit('state-changed', null);
      return report;
    },
    openClientInEditor: async (companyId) => {
      store.ensureClientFolders(companyId);
      return openClientWorkspace(paths, store.readCompany(companyId), tools.path);
    },
    createArea: async (companyId, name) => {
      const area = store.createArea(companyId, name);
      emit('state-changed', null);
      return area;
    },
    deleteArea: async (companyId, areaId) => {
      store.deleteArea(companyId, areaId);
      emit('state-changed', null);
    },
  };
}
