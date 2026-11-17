import { randomUUID } from 'node:crypto';
import type { HatstandApi } from '../../shared/api';
import { newTaskDraftSchema, type NewTaskDraft } from '../../shared/new-task-draft';
import type { ServiceContext } from './context';

export type NewTaskDraftService = Pick<HatstandApi, 'openNewTaskWindow' | 'readNewTaskDraft' | 'saveNewTaskDraft' | 'finishNewTaskWindow'>;

/** The windows a task is written in. The composition root opens the real ones; a test passes fakes. */
export type NewTaskWindows = {
  /** Opens the window of a draft, and calls onClosed when the person or the app closes it. */
  open(draftId: string, onClosed: () => void): void;
  close(draftId: string): void;
};

/** Tasks being written in a window of their own. The draft lives here, so closing the panel or reloading the window loses nothing. */
export function createNewTaskDraftService({ store, emit }: Pick<ServiceContext, 'store' | 'emit'>, { windows }: { windows: NewTaskWindows }): NewTaskDraftService {
  const drafts = new Map<string, NewTaskDraft>();
  return {
    openNewTaskWindow: async (draft) => {
      const parsed = newTaskDraftSchema.parse(draft);
      const draftId = randomUUID();
      drafts.set(draftId, parsed);
      windows.open(draftId, () => drafts.delete(draftId));
      return draftId;
    },
    readNewTaskDraft: async (draftId) => drafts.get(draftId) ?? null,
    saveNewTaskDraft: async (draftId, draft) => {
      if (drafts.has(draftId)) drafts.set(draftId, newTaskDraftSchema.parse(draft));
    },
    finishNewTaskWindow: async (draftId, taskId) => {
      const task = store.findTask(taskId);
      emit('state-changed', null);
      emit('task-created', { taskId: task.id, companyId: task.companyId });
      windows.close(draftId);
    },
  };
}
