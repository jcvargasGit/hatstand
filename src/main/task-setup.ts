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
  });
  if (guide && playbookId) {
    changeGuide(taskId, guide);
    store.recordGuideUse(playbookId);
  }
  return store.findTask(taskId);
}
