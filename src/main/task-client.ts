import type { Task, TaskGuide, TaskPatch } from '../shared/schemas';
import { accountInClient, clientChangeOf, type ClientChange } from '../shared/task-client';
import type { DataPaths } from './paths';
import { listPlaybooks, startGuide } from './playbooks';
import type { Store } from './store';

type Carried = Pick<Task, 'accountId' | 'guide'>;

/** The guide of a task, from its first step, when the other client has a guide with the same id. */
function guideInClient(paths: DataPaths, companyId: string, task: Task): TaskGuide | undefined {
  const playbook = listPlaybooks(paths, companyId).playbooks.find((item) => item.id === task.guide?.playbookId);
  return playbook && startGuide(playbook);
}

function cloneTask(store: Store, task: Task, companyId: string, carried: Carried): Task {
  if (task.companyId === companyId) throw new Error('This task is already in this client.');
  store.requireActiveCompany(companyId);
  const created = store.createTask({
    companyId,
    title: task.title,
    description: task.description,
    accountId: carried.accountId,
    checklist: task.checklist.map((item) => item.text),
    isolated: task.isolated,
    priority: task.priority,
  });
  const rest: TaskPatch = {
    ...(task.customTitle ? { customTitle: true } : {}),
    ...(task.type ? { type: task.type } : {}),
    ...(task.flag ? { flag: task.flag } : {}),
    ...(carried.guide ? { guide: carried.guide } : {}),
  };
  store.updateTask(created.id, rest);
  if (task.note) store.saveTaskNote(created.id, task.note);
  if (carried.guide) store.recordGuideUse(carried.guide.playbookId);
  return store.findTask(created.id);
}

/** Changes the client of a task: it moves when it was not started, and is copied to the other client when it was. */
export function changeTaskClient({ store, paths }: { store: Store; paths: DataPaths }, taskId: string, companyId: string): { task: Task; change: ClientChange } {
  const task = store.findTask(taskId);
  const change = clientChangeOf(task, store.listSessions());
  const carried: Carried = {
    accountId: accountInClient(task, store.readAccounts().accounts, companyId),
    guide: guideInClient(paths, companyId, task),
  };
  return { change, task: change === 'move' ? store.moveTask(taskId, companyId, carried) : cloneTask(store, task, companyId, carried) };
}
