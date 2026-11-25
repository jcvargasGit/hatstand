import { hasDraftText, newTaskDraftSchema, UNTITLED_DRAFT, type NewTaskDraft } from '../shared/new-task-draft';
import { taskSetupSchema, type Task, type TaskGuide, type TaskSetup } from '../shared/schemas';
import type { DataPaths } from './paths';
import { findPlaybook, startGuide } from './playbooks';
import type { Store } from './store';

export type TaskSetupDeps = {
  store: Store;
  paths: DataPaths;
  /** Gives the task its guide, writing the first step into a running session if there is one. */
  changeGuide: (taskId: string, guide: TaskGuide) => void;
};

/** Creates a task with its guide, and remembers that the guide was used. */
export function createTaskWithGuide({ store, paths }: Omit<TaskSetupDeps, 'changeGuide'>, input: Parameters<Store['createTask']>[0] & { playbookId?: string }): Task {
  const { playbookId, ...fields } = input;
  const task = store.createTask(fields);
  if (!playbookId) return task;
  const guided = store.updateTask(task.id, { guide: startGuide(findPlaybook(paths, fields.companyId, playbookId)) });
  store.recordGuideUse(playbookId);
  return guided;
}

/** Turns an inbox item into a task with the same choices as a new task: guide, area, repositories, agent, priority and code. */
export function makeTaskFromIdea({ store, paths, changeGuide }: TaskSetupDeps, taskId: string, input: TaskSetup): Task {
  const idea = store.findTask(taskId);
  if (idea.status !== 'idea') throw new Error('This is already a task.');
  const { playbookId, title, ...setup } = taskSetupSchema.parse(input);
  const guide = playbookId ? startGuide(findPlaybook(paths, idea.companyId, playbookId)) : undefined;
  store.updateTask(taskId, {
    ...setup,
    title,
    ...(title !== idea.title ? { customTitle: true } : {}),
    status: 'todo',
    draft: undefined,
  });
  if (guide && playbookId) {
    changeGuide(taskId, guide);
    store.recordGuideUse(playbookId);
  }
  return store.findTask(taskId);
}

const savedDraft = (store: Store, draftId: string | null): Task | undefined => {
  if (!draftId) return undefined;
  try {
    const task = store.findTask(draftId);
    return task.status === 'idea' && task.draft ? task : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Saves the New task form as a draft in the backlog of its client, and returns the id of the draft.
 * The same draft is written again while the person types. A form moved to another client leaves the
 * backlog of the first one, and a form emptied again leaves the backlog altogether: then there is no id.
 */
export function saveTaskDraft(store: Store, draftId: string | null, input: NewTaskDraft): string | null {
  const form = newTaskDraftSchema.parse(input);
  const existing = savedDraft(store, draftId);
  if (!hasDraftText(form)) {
    if (existing) store.deleteTask(existing.id);
    return null;
  }
  const untitled = form.title.trim() === '';
  const fields = {
    title: untitled ? UNTITLED_DRAFT : form.title.trim(),
    description: form.description,
    subdomainId: form.areaId || undefined,
    projectIds: form.projectIds,
    accountId: form.accountId || undefined,
    priority: form.priority,
    isolated: form.isolated,
  };
  const draft = { playbookId: form.playbookId, guideChosen: form.guideChosen, areaChosen: form.areaChosen, untitled, suggestionKey: form.suggestionKey };
  if (existing && existing.companyId === form.companyId) return store.updateTask(existing.id, { ...fields, draft }).id;
  if (existing) store.deleteTask(existing.id);
  const created = store.createTask({ companyId: form.companyId, ...fields }, undefined, 'idea');
  return store.updateTask(created.id, { draft }).id;
}
