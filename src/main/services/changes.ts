import type { HatstandApi } from '../../shared/api';
import { repoChanges, taskFileDiff, taskRepoChanges } from '../git-changes';
import { outsideFileText, taskOutsideChanges } from '../outside-changes';
import type { SessionManager } from '../sessions';
import { findGitRoot } from '../paths';
import type { ServiceContext } from './context';

/** What changed in the code, in the copies of a task and in the planning repository, and what a task changed outside git. */
export type ChangeService = Pick<HatstandApi, 'planningStatus' | 'taskChanges' | 'taskFileDiff' | 'taskOutsideChanges' | 'taskOutsideFile'>;

export type ChangeServiceDeps = { sessions: Pick<SessionManager, 'outsideChangesSettled'> };

export function createChangeService({ store, tools, paths }: Pick<ServiceContext, 'store' | 'tools' | 'paths'>, { sessions }: ChangeServiceDeps): ChangeService {
  return {
    planningStatus: async (companyId) => {
      const planning = store.readCompany(companyId).planning;
      if (!planning || !findGitRoot(planning.path)) return null;
      return { projectId: 'planning', name: 'Planning repository', path: planning.path, committed: [], before: [], commits: 0, ...(await repoChanges(planning.path, tools.path)) };
    },
    taskChanges: async (taskId) => {
      const task = store.findTask(taskId);
      return taskRepoChanges(store.readCompany(task.companyId), task, tools.path, store.firstSessionAt(taskId));
    },
    taskFileDiff: async (taskId, projectId, file) => {
      const task = store.findTask(taskId);
      return taskFileDiff(store.readCompany(task.companyId), task, projectId, file, tools.path);
    },
    taskOutsideChanges: async (taskId) => {
      await sessions.outsideChangesSettled(taskId);
      const task = store.findTask(taskId);
      return taskOutsideChanges(paths, store, store.readCompany(task.companyId), task);
    },
    taskOutsideFile: async (taskId, path) => {
      const task = store.findTask(taskId);
      return outsideFileText(paths, store.readCompany(task.companyId), task, path);
    },
  };
}
