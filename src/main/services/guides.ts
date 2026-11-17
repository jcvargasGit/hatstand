import type { HatstandApi } from '../../shared/api';
import { createPlaybook, customizePlaybook, findPlaybook, listPlaybooks, removePlaybook, startGuide } from '../playbooks';
import type { SessionManager } from '../sessions';
import type { ServiceContext } from './context';

export type GuideService = Pick<HatstandApi, 'listPlaybooks' | 'customizePlaybook' | 'createPlaybook' | 'removePlaybook' | 'setTaskGuide' | 'moveGuideStep'>;

export function createGuideService({ store, paths }: Pick<ServiceContext, 'store' | 'paths'>, { sessions }: { sessions: Pick<SessionManager, 'changeGuide' | 'moveGuideStep'> }): GuideService {
  return {
    listPlaybooks: async (companyId) => listPlaybooks(paths, companyId),
    customizePlaybook: async (companyId, playbookId) => customizePlaybook(paths, companyId, playbookId),
    createPlaybook: async (companyId, name) => createPlaybook(paths, companyId, name),
    removePlaybook: async (companyId, playbookId) => removePlaybook(paths, companyId, playbookId),
    setTaskGuide: async (taskId, playbookId) => {
      if (playbookId === null) {
        store.updateTask(taskId, { guide: undefined, type: undefined });
        return;
      }
      sessions.changeGuide(taskId, startGuide(findPlaybook(paths, store.findTask(taskId).companyId, playbookId)));
      store.updateTask(taskId, { type: undefined });
    },
    moveGuideStep: async (taskId, index) => sessions.moveGuideStep(taskId, index),
  };
}
