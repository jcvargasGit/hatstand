import { existsSync } from 'node:fs';
import type { ClientFolderSection } from '../../shared/api';
import { areaFolder } from '../../shared/areas';
import { activeFolder, activePluginDir } from '../active-folders';
import { allowedFile } from '../client-files';
import { editorTarget, type EditorTarget } from '../editor-target';
import { recordedChange } from '../outside-changes';
import { activeWorktrees, sessionFolder, workingDirFor } from '../task-folders';
import type { ServiceContext } from './context';

/**
 * What the desktop should open for each request of the interface. Choosing it needs no Electron,
 * so it lives here, and src/main/index.ts only opens what it is given.
 */
export type DesktopTargets = {
  /** A folder or a file of the client. A path outside the client is refused. */
  inEditor(companyId: string, path: string): EditorTarget;
  clientFolder(companyId: string, folder: ClientFolderSection | 'instructions'): string;
  clientFile(companyId: string, path: string): string;
  areaFolder(companyId: string, areaId: string): string;
  /** The copy a task has of one repository. */
  taskCopy(taskId: string, projectId: string): string;
  /** The folder the agent of the task works in. */
  taskFolder(taskId: string): string;
  /** The notes file of a task, created when the task has none yet. */
  taskNotes(taskId: string): string;
  taskOutput(taskId: string, name: string): string;
  /** A file the task changed outside git, or the folder of a repository it created. A path that was not recorded is refused. */
  taskChangedFile(taskId: string, path: string): EditorTarget;
};

export function createDesktopTargets({ store, paths }: Pick<ServiceContext, 'store' | 'paths'>): DesktopTargets {
  return {
    inEditor: (companyId, path) => {
      const company = store.readCompany(companyId);
      const tasks = store.listTasks(companyId);
      const copies = tasks.flatMap((task) => task.worktrees.map((worktree) => worktree.path));
      const folders = [...company.projects.map((project) => project.path), company.planning?.path, company.rootDir, ...copies].filter((folder) => folder !== undefined);
      const documents = tasks.flatMap((task) => store.listTaskOutputs(task).map((output) => output.path));
      const target = editorTarget(folders, documents, path);
      if (!target) throw new Error('This is not part of this client.');
      return target;
    },
    clientFolder: (companyId, folder) => {
      store.ensureClientFolders(companyId);
      const company = store.readCompany(companyId);
      return folder === 'instructions' ? (company.context.instructionsFile ?? activePluginDir(paths, company)) : activeFolder(paths, company, folder);
    },
    clientFile: (companyId, path) => allowedFile(paths, store.readCompany(companyId), path),
    areaFolder: (companyId, areaId) => {
      const area = store.readCompany(companyId).subdomains.find((item) => item.id === areaId);
      if (!area) throw new Error('This area is no longer part of this client.');
      return paths.areaDir(companyId, areaFolder(area));
    },
    taskCopy: (taskId, projectId) => {
      const worktree = store.findTask(taskId).worktrees.find((item) => item.projectId === projectId);
      if (!worktree) throw new Error('This task has no copy of that repository.');
      if (!existsSync(worktree.path)) throw new Error(`The folder ${worktree.path} is gone.`);
      return worktree.path;
    },
    taskFolder: (taskId) => {
      const task = store.findTask(taskId);
      const company = store.readCompany(task.companyId);
      return sessionFolder(activeWorktrees(company, task)) ?? workingDirFor(paths, company, task);
    },
    taskNotes: (taskId) => {
      const task = store.findTask(taskId);
      const file = paths.notesFile(task.companyId, task.id);
      if (!existsSync(file)) store.writeNotes(task, '');
      return file;
    },
    taskOutput: (taskId, name) => store.taskOutputFile(store.findTask(taskId), name),
    taskChangedFile: (taskId, path) => {
      const task = store.findTask(taskId);
      const change = recordedChange(paths, store.readCompany(task.companyId), task, path);
      if (change.status === 'deleted') throw new Error('This file was deleted, so there is nothing to open.');
      return { kind: change.status === 'repository' ? 'folder' : 'file', path: change.path };
    },
  };
}

/** A link the interface may open in the browser. Anything that is not a web link is refused. */
export function webLink(url: string): string {
  const { protocol } = new URL(url);
  if (protocol !== 'https:' && protocol !== 'http:') throw new Error('Only web links can be opened.');
  return url;
}
