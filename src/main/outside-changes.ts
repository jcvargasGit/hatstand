// The files a task changed outside the repositories that Changes reports through git: folders without
// git, such as planning, knowledge and task documents. They come from two sources, the files the agent
// wrote with its tools and what a snapshot of its folders found, and are kept in one file per task.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { outsideChangeSchema, type Company, type OutsideChange, type OutsideChanges, type Task } from '../shared/schemas';
import { parseFileWrites, type FileWrite } from './agents/file-writes';
import { newFileText, reportedRepos } from './git-changes';
import { findGitRoot, type DataPaths } from './paths';
import { writePrivateFile, type Store } from './store';
import { activeWorktrees } from './task-folders';

export const MAX_OUTSIDE_CHANGES = 300;
const MAX_RECORDED_FILES = 2000;

type Status = OutsideChange['status'];

const recordSchema = z.object({
  /** The folders the sessions of the task could write to. A file is listed under the one it is in. */
  folders: z.array(z.string()).default([]),
  files: z.record(z.string(), outsideChangeSchema.shape.status).default({}),
  /** How far the activity file of each session was read, so a write is recorded once. */
  activityRead: z.record(z.string(), z.number()).default({}),
  truncated: z.boolean().default(false),
});
type ChangeRecord = z.infer<typeof recordSchema>;

/** The path with its links resolved, also for a file that is gone, so the same file always has the same path. */
export function realPath(path: string): string {
  const absolute = resolve(path);
  if (existsSync(absolute)) return realpathSync(absolute);
  const parent = dirname(absolute);
  return parent === absolute ? absolute : join(realPath(parent), basename(absolute));
}

export const isInside = (path: string, folders: string[]): boolean => folders.some((folder) => path === folder || path.startsWith(`${folder}${sep}`));

const gitFolders = (folders: string[]) => folders.filter((folder) => findGitRoot(folder) !== null).map(realPath);

/** The repositories whose changes git already reports for the task. A file inside one is not listed again. */
export const reportedByGit = (company: Company, task: Task): string[] => gitFolders(reportedRepos(company, task).map((repo) => repo.path));

/** Every repository of the client, and the copies of the task. A snapshot does not read them: git knows what changed there. */
export const clientRepos = (company: Company, task: Task): string[] =>
  gitFolders([...company.projects.map((project) => project.path), ...activeWorktrees(company, task).map((worktree) => worktree.path)]);

/** The folders to take a snapshot of: the ones a session can write to, without repeats, and without the ones a snapshot skips. */
export function watchedFolders(candidates: string[], skipped: string[]): string[] {
  const folders = [...new Set(candidates.filter((folder) => existsSync(folder)).map(realPath))].filter((folder) => !isInside(folder, skipped));
  return folders.filter((folder) => !folders.some((other) => other !== folder && isInside(folder, [other])));
}

/**
 * What a file is after one more change. A new file that is deleted leaves no trace, a file that was not
 * there when the turn started is new even when a tool only reported an edit, and a new repository stays one.
 */
export function mergeStatus(previous: Status | undefined, next: Status): Status | null {
  if (!previous || previous === 'repository' || next === 'repository') return previous === 'repository' ? previous : next;
  if (next === 'deleted') return previous === 'added' ? null : 'deleted';
  if (previous === 'deleted') return 'modified';
  return previous === 'added' || next === 'added' ? 'added' : 'modified';
}

function readRecord(paths: DataPaths, taskId: string): ChangeRecord {
  try {
    return recordSchema.parse(JSON.parse(readFileSync(paths.taskChangesFile(taskId), 'utf8')));
  } catch {
    return recordSchema.parse({});
  }
}

function withChanges(record: ChangeRecord, changes: OutsideChange[]): ChangeRecord {
  const files = { ...record.files };
  for (const change of changes) {
    const status = mergeStatus(files[change.path], change.status);
    if (status) files[change.path] = status;
    else delete files[change.path];
  }
  const kept = Object.entries(files).slice(0, MAX_RECORDED_FILES);
  return { ...record, files: Object.fromEntries(kept), truncated: record.truncated || kept.length < Object.keys(files).length };
}

export type RecordedTurn = { changes: OutsideChange[]; folders: string[]; truncated: boolean };

/** Adds what a turn changed to the record of the task. */
export function recordOutsideChanges(paths: DataPaths, taskId: string, turn: RecordedTurn): void {
  const record = readRecord(paths, taskId);
  const updated = withChanges({ ...record, folders: [...new Set([...record.folders, ...turn.folders])], truncated: record.truncated || turn.truncated }, turn.changes);
  writePrivateFile(paths.taskChangesFile(taskId), JSON.stringify(updated));
}

const statusOfWrite = (write: FileWrite): Status => (write.kind === 'create' ? 'added' : write.kind === 'delete' ? 'deleted' : 'modified');

/** Adds the files the agent wrote with its tools since the last read. Only whole lines are read, so a line still being written waits. */
export function recordToolWrites(paths: DataPaths, taskId: string, sessionIds: string[]): void {
  const record = readRecord(paths, taskId);
  const activityRead = { ...record.activityRead };
  const writes = sessionIds.flatMap((sessionId) => {
    const file = paths.activityFile(sessionId);
    if (!existsSync(file) || statSync(file).size === (activityRead[sessionId] ?? 0)) return [];
    const content = readFileSync(file);
    const from = Math.min(activityRead[sessionId] ?? 0, content.length);
    const fresh = content.subarray(from, content.lastIndexOf('\n') + 1);
    activityRead[sessionId] = from + fresh.length;
    return parseFileWrites(fresh.toString('utf8'));
  });
  if (JSON.stringify(activityRead) === JSON.stringify(record.activityRead)) return;
  const changes = writes.map((write) => ({ path: realPath(write.path), status: statusOfWrite(write) }));
  writePrivateFile(paths.taskChangesFile(taskId), JSON.stringify(withChanges({ ...record, activityRead }, changes)));
}

/** A file that came back or went away after it was recorded is shown as it is now. */
function currentStatus(path: string, status: Status): Status | null {
  const exists = existsSync(path);
  if (status === 'deleted') return exists ? 'modified' : 'deleted';
  if (exists) return status;
  return status === 'modified' ? 'deleted' : null;
}

function recordedChanges(paths: DataPaths, company: Company, task: Task): { record: ChangeRecord; changes: OutsideChange[] } {
  const record = readRecord(paths, task.id);
  const reported = reportedByGit(company, task);
  const changes = Object.entries(record.files)
    .filter(([path]) => !isInside(path, reported))
    .flatMap(([path, recorded]) => {
      const status = currentStatus(path, recorded);
      return status ? [{ path, status }] : [];
    })
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  return { record, changes };
}

const folderOf = (path: string, folders: string[]): string =>
  folders.filter((folder) => isInside(path, [folder])).sort((a, b) => b.length - a.length)[0] ?? dirname(path);

/** What Changes lists outside git for a task, by folder. It first reads what the tools of the agent wrote since the last time. */
export function taskOutsideChanges(paths: DataPaths, store: Pick<Store, 'listSessions'>, company: Company, task: Task): OutsideChanges {
  const sessions = store.listSessions().filter((session) => session.taskId === task.id);
  recordToolWrites(paths, task.id, sessions.map((session) => session.id));
  const { record, changes } = recordedChanges(paths, company, task);
  const listed = changes.slice(0, MAX_OUTSIDE_CHANGES);
  const folders = [...new Set(listed.map((change) => folderOf(change.path, record.folders)))].sort();
  return {
    folders: folders.map((folder) => ({ folder, changes: listed.filter((change) => folderOf(change.path, record.folders) === folder) })),
    truncated: record.truncated || changes.length > listed.length,
  };
}

/** One of the files recorded for the task. Any other path is refused, so the page cannot ask for a file Hatstand did not list. */
export function recordedChange(paths: DataPaths, company: Company, task: Task, path: string): OutsideChange {
  const change = recordedChanges(paths, company, task).changes.find((item) => item.path === path);
  if (!change) throw new Error('This file is not among the changes of this task.');
  return change;
}

/** What to show for a file outside git. No earlier copy is kept, so only a new file shows its content. */
export async function outsideFileText(paths: DataPaths, company: Company, task: Task, path: string): Promise<string> {
  const change = recordedChange(paths, company, task, path);
  if (change.status === 'added') return newFileText(change.path);
  if (change.status === 'deleted') return 'This file was deleted.';
  if (change.status === 'repository') return 'This is a new repository. Open it in your editor to see its files.';
  return 'This file is outside git, so there is no earlier copy to compare it with. Open it in your editor to read it.';
}
