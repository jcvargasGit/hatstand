import { ExternalLink, GitBranch } from 'lucide-react';
import type { Company, Task } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { useEditorName } from '../hooks/useEditorName';
import { api } from '../lib/api';
import { baseLabel } from '../lib/text';
import { workRepositories } from '../../../shared/work-repos';

type TaskCodeProps = {
  task: Task;
  company: Company;
  isLive: boolean;
  onChanged: () => Promise<void>;
};

export function TaskCode({ task, company, isLive, onChanged }: TaskCodeProps) {
  const { error, busy, run } = useAction();
  const editorName = useEditorName();
  const repos = workRepositories(company);
  if (repos.length === 0) return null;
  const repoName = (projectId: string) => company.projects.find((project) => project.id === projectId)?.name ?? 'Repository';
  const reading = repos.filter((project) => task.projectIds.includes(project.id) && !task.worktrees.some((worktree) => worktree.projectId === project.id));

  return (
    <div className="task-code">
      <div className="task-changes-head">
        <h3>Copies of the code</h3>
        {task.isolated && task.worktrees.length > 0 && (
          <button className="quiet" disabled={busy} onClick={() => void run(async () => void (await api.openTaskInEditor(task.id)))}>
            <ExternalLink size={14} />
            {editorName ? `Open in ${editorName}` : 'Open in your editor'}
          </button>
        )}
        {task.isolated && task.worktrees.length > 0 && (
          <button
            className="quiet"
            disabled={busy || isLive}
            title={isLive ? 'Stop the session first.' : 'Removes the folder and keeps the branch, so nothing committed is lost.'}
            onClick={() =>
              void run(async () => {
                await api.removeTaskCopies(task.id);
                await onChanged();
              })
            }
          >
            Remove copy
          </button>
        )}
      </div>
      {!task.isolated && <p className="hint">This task works in the client’s shared folder. Other tasks can change the same files.</p>}
      {task.isolated && task.worktrees.length === 0 && (
        <p className="hint">No copies yet. When the agent needs to change a repository, it makes one on a new branch.</p>
      )}
      {task.isolated && task.worktrees.length > 0 && (
        <ul className="task-code-list">
          {task.worktrees.map((worktree) => (
            <li key={worktree.projectId}>
              <GitBranch size={14} />
              <strong>{repoName(worktree.projectId)}</strong>
              <span className="hint" title={worktree.path}>
                {worktree.branch}, from {baseLabel(worktree.base)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {task.isolated && reading.length > 0 && <p className="hint">Only reading: {reading.map((project) => project.name).join(', ')}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
