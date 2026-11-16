import type { FileChange, RepoChanges } from '../../../shared/api';

export type RepoWork = { projectId: string; name: string; path: string; branch: string | null; created: string[]; changed: string[]; deleted: string[]; commits: number };

const CREATED = new Set<FileChange['status']>(['added', 'untracked']);

/**
 * What the agent did to one repository: the files it created, changed or deleted, committed or not.
 * A file counts once, with its latest state. Files changed before the agent started are left out.
 */
export function repoWork(repo: RepoChanges): RepoWork {
  const latest = new Map<string, FileChange['status']>();
  for (const change of [...repo.committed, ...repo.changes]) latest.set(change.path, change.status);
  const paths = (keep: (status: FileChange['status']) => boolean) => [...latest].filter(([, status]) => keep(status)).map(([path]) => path).sort();
  return {
    projectId: repo.projectId,
    name: repo.name,
    path: repo.path,
    branch: repo.branch,
    created: paths((status) => CREATED.has(status)),
    changed: paths((status) => status === 'modified' || status === 'renamed'),
    deleted: paths((status) => status === 'deleted'),
    commits: repo.commits,
  };
}

export const hasWork = (work: RepoWork): boolean => work.created.length + work.changed.length + work.deleted.length > 0 || work.commits > 0;

/** Where a file of a repository is on disk, to open it in the editor. */
export const fileInRepo = (repoPath: string, file: string): string => `${repoPath.replace(/[\\/]+$/, '')}/${file}`;
