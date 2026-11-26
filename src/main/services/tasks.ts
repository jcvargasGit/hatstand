import { readFileSync } from 'node:fs';
import type { HatstandApi } from '../../shared/api';
import { parseIssueReference } from '../../shared/issue-reference';
import type { DescriptionSuggester } from '../description-suggestion';
import type { SessionManager } from '../sessions';
import { changeTaskClient } from '../task-client';
import { createTaskWithGuide, makeTaskFromIdea, saveTaskDraft } from '../task-setup';
import { syncTrackers } from '../trackers/sync';
import type { CodeCopies } from './code-copies';
import type { ServiceContext } from './context';

export type TaskService = Pick<
  HatstandApi,
  | 'createTask'
  | 'makeTask'
  | 'saveTaskDraft'
  | 'updateTask'
  | 'changeTaskClient'
  | 'linkTaskIssue'
  | 'unlinkTaskIssue'
  | 'deleteTask'
  | 'reorderTasks'
  | 'readNotes'
  | 'readTaskNote'
  | 'saveTaskNote'
  | 'listTaskOutputs'
  | 'readTaskOutput'
  | 'removeTaskCopies'
  | 'syncTrackers'
  | 'suggestDescription'
  | 'cancelDescriptionSuggestion'
  | 'descriptionInstructions'
>;

export type TaskServiceDeps = {
  sessions: Pick<SessionManager, 'hasLiveSession' | 'changeGuide'>;
  copies: CodeCopies;
  suggester: Pick<DescriptionSuggester, 'suggest' | 'cancel' | 'instructionsFor'>;
};

export function createTaskService({ store, paths, secrets, emit, fetch }: ServiceContext, { sessions, copies, suggester }: TaskServiceDeps): TaskService {
  return {
    createTask: async (input) => createTaskWithGuide({ store, paths }, input),
    makeTask: async (taskId, setup) => {
      const task = makeTaskFromIdea({ store, paths, changeGuide: (id, guide) => sessions.changeGuide(id, guide) }, taskId, setup);
      emit('state-changed', null);
      return task;
    },
    saveTaskDraft: async (draftId, form) => {
      const saved = saveTaskDraft(store, draftId, form);
      emit('state-changed', null);
      return saved;
    },
    updateTask: async (taskId, patch) => store.updateTask(taskId, patch),
    changeTaskClient: async (taskId, companyId) => {
      const result = changeTaskClient({ store, paths }, taskId, companyId);
      emit('state-changed', null);
      if (result.task.status !== 'idea') emit('task-created', { taskId: result.task.id, companyId });
      return result;
    },
    linkTaskIssue: async (taskId, reference) => {
      const task = store.linkTaskSource(taskId, parseIssueReference(reference));
      emit('state-changed', null);
      return task;
    },
    unlinkTaskIssue: async (taskId) => {
      const task = store.linkTaskSource(taskId, undefined);
      emit('state-changed', null);
      return task;
    },
    deleteTask: async (taskId) => {
      if (sessions.hasLiveSession(taskId)) throw new Error('Stop the session before deleting this task.');
      await copies.removeCopies(taskId, true);
      store.deleteTask(taskId);
      emit('state-changed', null);
    },
    reorderTasks: async (taskIds) => {
      taskIds.forEach((taskId, rank) => store.updateTask(taskId, { rank }));
      emit('state-changed', null);
    },
    readNotes: async (taskId) => store.readNotes(store.findTask(taskId)),
    readTaskNote: async (taskId) => store.findTask(taskId).note,
    saveTaskNote: async (taskId, note) => store.saveTaskNote(taskId, note),
    listTaskOutputs: async (taskId) => store.listTaskOutputs(store.findTask(taskId)),
    readTaskOutput: async (taskId, name) => readFileSync(store.taskOutputFile(store.findTask(taskId), name), 'utf8'),
    removeTaskCopies: async (taskId) => {
      if (sessions.hasLiveSession(taskId)) throw new Error('Stop the session before removing the copy of the code.');
      await copies.removeCopies(taskId, true);
      emit('state-changed', null);
    },
    syncTrackers: async (companyId) => {
      const report = await syncTrackers(store, companyId, secrets.read(companyId), fetch, secrets);
      emit('state-changed', null);
      return report;
    },
    suggestDescription: async (request) => suggester.suggest(request),
    cancelDescriptionSuggestion: async (key) => suggester.cancel(key),
    descriptionInstructions: async (companyId, subdomainId) => suggester.instructionsFor(companyId, subdomainId),
  };
}
