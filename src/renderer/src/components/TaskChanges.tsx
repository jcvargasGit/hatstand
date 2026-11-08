import { ExternalLink, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { FileChange, RepoChanges } from '../../../shared/api';
import type { Task } from '../../../shared/schemas';
import { useTaskChanges } from '../hooks/useTaskChanges';
import { api } from '../lib/api';
import { plural } from '../lib/text';

type TaskChangesProps = {
  task: Task;
  refreshKey: string;
};

type OpenDiff = { projectId: string; change: FileChange; text: string };

const lineClass = (line: string) => {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'diff-added';
  if (line.startsWith('-') && !line.startsWith('---')) return 'diff-removed';
  return line.startsWith('@@') ? 'diff-hunk' : undefined;
};

export function changeSummary(repo: Pick<RepoChanges, 'changes' | 'committed' | 'commits'>): string {
  const parts = [
    repo.changes.length > 0 ? `${plural(repo.changes.length, 'file', 'files')} not committed` : null,
    repo.commits > 0 ? `${plural(repo.commits, 'commit', 'commits')} on this branch` : null,
  ];
  return parts.filter(Boolean).join(', ');
}

export function TaskChanges({ task, refreshKey }: TaskChangesProps) {
  const { reports, repos, reload, error, busy, run } = useTaskChanges(task.id, refreshKey);
  const [open, setOpen] = useState<OpenDiff | null>(null);
  const [showOlder, setShowOlder] = useState(false);
  const olderFiles = reports.reduce((count, repo) => count + repo.before.length, 0);

  const fileList = (repo: RepoChanges, title: string, files: FileChange[]) =>
    files.length > 0 && (
      <>
        <h4>{title}</h4>
        <ul>
          {files.map((change) => (
            <li key={change.path}>
              <button
                className="client-file"
                aria-current={open?.projectId === repo.projectId && open.change.path === change.path ? 'true' : undefined}
                title={change.path}
                onClick={() => void run(async () => setOpen({ projectId: repo.projectId, change, text: await api.taskFileDiff(task.id, repo.projectId, change.path) }))}
              >
                <span>{change.path}</span>
                <small>{change.status}</small>
              </button>
            </li>
          ))}
        </ul>
      </>
    );

  return (
    <div className="task-changes">
      <div className="task-changes-head">
        <h3>Changes</h3>
        <span className="hint">{repos.length === 0 ? 'This task has not changed any repository yet.' : `In ${plural(repos.length, 'repository', 'repositories')}`}</span>
        <button className="quiet" disabled={busy} aria-label="Refresh changes" title="Refresh changes" onClick={() => void reload()}>
          <RefreshCw size={14} />
        </button>
      </div>
      {!task.isolated && repos.length > 0 && <p className="hint">Files changed since the agent first worked on this task. In the shared folder, this also includes your own edits and those of other tasks since then.</p>}
      {olderFiles > 0 && (
        <p className="task-changes-older hint">
          {plural(olderFiles, 'file was', 'files were')} already changed before the agent started, so {olderFiles === 1 ? 'it is' : 'they are'} hidden.
          <button className="quiet" onClick={() => setShowOlder((shown) => !shown)}>
            {showOlder ? 'Hide them' : olderFiles === 1 ? 'Show it' : 'Show them'}
          </button>
        </p>
      )}
      {(showOlder ? reports : repos).map((repo) => (
        <div key={repo.projectId} className="task-changes-repo">
          <p>
            <strong>{repo.name}</strong>
            {repo.branch && <span className="hint">{repo.branch}</span>}
            <span className="hint">{changeSummary(repo)}</span>
            <button className="quiet" aria-label={`Open ${repo.name} in editor`} onClick={() => void run(() => api.openInEditor(task.companyId, repo.path))}>
              <ExternalLink size={14} />
              Open in editor
            </button>
          </p>
          {fileList(repo, 'Not committed', repo.changes)}
          {fileList(repo, 'Committed on this branch', repo.committed.filter((change) => !repo.changes.some((other) => other.path === change.path)))}
          {showOlder && fileList(repo, 'Already changed before the agent started', repo.before)}
          {repo.truncated && <p className="hint">Showing the first files only. Open the repository in your editor to see them all.</p>}
        </div>
      ))}
      {open && (
        <pre className="diff" aria-label={`Changes in ${open.change.path}`}>
          {open.text.split('\n').map((line, index) => (
            <span key={index} className={lineClass(line)}>
              {line}
              {'\n'}
            </span>
          ))}
        </pre>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
