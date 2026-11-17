import { keptMessage, removeWorktrees, type RemoveReport } from '../worktrees';
import type { ServiceContext } from './context';

export type CodeCopies = {
  /**
   * Removes the copies of the code a task has, and forgets those that are gone.
   * With onlyIfClean, a copy kept for having work in it is an error, after the others are removed.
   */
  removeCopies(taskId: string, onlyIfClean: boolean): Promise<RemoveReport>;
};

export function createCodeCopies({ store, tools }: Pick<ServiceContext, 'store' | 'tools'>, remove: typeof removeWorktrees = removeWorktrees): CodeCopies {
  return {
    removeCopies: async (taskId, onlyIfClean) => {
      const task = store.findTask(taskId);
      const report = await remove(store.readCompany(task.companyId), task, tools.path);
      // Removing takes a while, and the agent may have asked for another copy meanwhile, so the task is read again.
      const current = store.findTask(taskId).worktrees;
      store.setTaskCode(taskId, current.filter((worktree) => !report.removed.includes(worktree.path)));
      if (onlyIfClean && report.kept.length > 0) throw new Error(keptMessage(report));
      return report;
    },
  };
}
