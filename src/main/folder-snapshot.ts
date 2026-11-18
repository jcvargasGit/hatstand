// What is in a set of folders at one moment, and what changed between two of those moments. It finds the
// files an agent wrote with shell commands, which no hook reports.
import { lstat, readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { z } from 'zod';
import type { OutsideChange } from '../shared/schemas';

export const SKIPPED_FOLDERS: readonly string[] = ['.git', 'node_modules', 'dist', 'out', 'build', 'target', '.venv', '.next', '.cache'];
const SKIPPED_FILES: readonly string[] = ['.DS_Store'];
export const SNAPSHOT_LIMITS = { maxFiles: 5000, maxDepth: 8 };
export const snapshotSchema = z.object({
  /** A file written from this moment on was written after the snapshot, or while it was being taken. */
  since: z.number(),
  files: z.record(z.string(), z.object({ mtimeMs: z.number(), size: z.number() })),
  /** The folders that are git repositories. */
  repos: z.array(z.string()),
  /** Whether a limit was reached, so part of the folders is missing. */
  truncated: z.boolean(),
});
export type FolderSnapshot = z.infer<typeof snapshotSchema>;

export type SnapshotOptions = {
  /** Folders left out with everything inside them, such as the repositories git already reports. */
  skip?: string[];
  ignore?: (file: string) => boolean;
  limits?: typeof SNAPSHOT_LIMITS;
  since?: number;
};

type Stamp = FolderSnapshot['files'][string];

async function stamp(file: string): Promise<[string, Stamp] | null> {
  try {
    const { mtimeMs, size } = await lstat(file);
    return [file, { mtimeMs, size }];
  } catch {
    return null;
  }
}

/**
 * Reads the folders level by level, in name order, so two snapshots with the same limits cover the same
 * files. It stops at the limits instead of reading a huge folder to the end.
 */
export async function snapshotFolders(folders: string[], options: SnapshotOptions = {}): Promise<FolderSnapshot> {
  const { skip = [], ignore = () => false, limits = SNAPSHOT_LIMITS, since = Date.now() } = options;
  const files: FolderSnapshot['files'] = {};
  const repos: string[] = [];
  const queue = folders.map((folder) => ({ folder, depth: 0 }));
  let truncated = false;
  let foldersRead = 0;

  for (let next = queue.shift(); next; next = queue.shift()) {
    if (skip.includes(next.folder)) continue;
    if (foldersRead >= limits.maxFiles) {
      truncated = true;
      break;
    }
    foldersRead += 1;
    const entries = (await readdir(next.folder, { withFileTypes: true }).catch(() => [])).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (entries.some((entry) => entry.name === '.git')) repos.push(next.folder);

    const inside = entries.filter((entry) => entry.isDirectory() && !SKIPPED_FOLDERS.includes(entry.name));
    if (next.depth >= limits.maxDepth) truncated ||= inside.length > 0;
    else queue.push(...inside.map((entry) => ({ folder: join(next.folder, entry.name), depth: next.depth + 1 })));

    const names = entries.filter((entry) => !entry.isDirectory() && !SKIPPED_FILES.includes(entry.name)).map((entry) => join(next.folder, entry.name));
    const wanted = names.filter((file) => !ignore(file));
    const room = limits.maxFiles - Object.keys(files).length;
    if (wanted.length > room) truncated = true;
    for (const found of await Promise.all(wanted.slice(0, room).map(stamp))) {
      if (found) files[found[0]] = found[1];
    }
    if (wanted.length > room) break;
  }
  return { since, files, repos, truncated };
}

const isInside = (path: string, folders: string[]) => folders.some((folder) => path === folder || path.startsWith(`${folder}${sep}`));

/**
 * What changed from one snapshot to the next. A new repository is one entry, without its files.
 * A file written while the first snapshot was being taken is in it already, so its time tells that it changed.
 * When a snapshot is cut short, a file may only seem new or gone because the cut moved, so a new file
 * must also have been written during the turn, and no file is reported as deleted.
 */
export function diffSnapshots(before: FolderSnapshot, after: FolderSnapshot): { changes: OutsideChange[]; truncated: boolean } {
  const truncated = before.truncated || after.truncated;
  const newRepos = after.repos.filter((repo) => !before.repos.includes(repo));
  const changes: OutsideChange[] = newRepos.map((path) => ({ path, status: 'repository' }));

  for (const [path, now] of Object.entries(after.files)) {
    if (isInside(path, newRepos)) continue;
    const old = before.files[path];
    const writtenInTurn = now.mtimeMs >= before.since;
    if (!old && (!truncated || writtenInTurn)) changes.push({ path, status: 'added' });
    if (old && (old.mtimeMs !== now.mtimeMs || old.size !== now.size || writtenInTurn)) changes.push({ path, status: 'modified' });
  }
  if (!truncated) {
    for (const path of Object.keys(before.files)) {
      if (!Object.hasOwn(after.files, path) && !isInside(path, newRepos)) changes.push({ path, status: 'deleted' });
    }
  }
  return { changes, truncated };
}
