import { FolderGit2, GitBranch } from 'lucide-react';
import type { Company, Task } from '../../../shared/schemas';
import { taskRepositories } from '../../../shared/work-repos';
import { useAction } from '../hooks/useAction';
import { useRepositoryLinks } from '../hooks/useRepositoryLinks';
import { api } from '../lib/api';
import { baseLabel } from '../lib/text';
import { OpenInEditorButton } from './OpenInEditorButton';
import { RepoSiteButton } from './RepoSiteButton';

type TaskRepositoriesProps = {
  task: Task;
  company: Company;
  isLive: boolean;
  onChanged: () => Promise<void>;
};

/** The repositories this task works with. Each opens in the editor: its copy for this task when it has one, and the original. */
export function TaskRepositories({ task, company, isLive, onChanged }: TaskRepositoriesProps) {
  const { error, busy, run } = useAction();
  const repos = taskRepositories(company, task);
  const copies = task.isolated ? task.worktrees : [];
  const webUrls = useRepositoryLinks(company.id);

  if (repos.length === 0) {
    return (
      <section className="task-repositories" aria-label="Repositories of this task">
        <h3>Repositories of this task</h3>
        <p className="hint">{task.isolated ? 'No repository is selected. The agent starts in the client folder.' : 'This task works in the client’s shared folder.'}</p>
      </section>
    );
  }

  return (
    <section className="task-repositories" aria-label="Repositories of this task">
      <h3>Repositories of this task</h3>
      <ul className="task-repositories-list">
        {repos.map((repo) => {
          const copy = copies.find((worktree) => worktree.projectId === repo.id);
          return (
            <li key={repo.id}>
              {copy ? <GitBranch size={14} /> : <FolderGit2 size={14} />}
              <span className="task-repositories-name">
                <strong>{repo.name}</strong>
                <small className="hint" title={copy?.path ?? repo.path}>
                  {copy ? `Copy on ${copy.branch}, from ${baseLabel(copy.base)}` : task.isolated ? 'Only reading, until the agent needs to change it' : 'Shared folder'}
                </small>
              </span>
              <span className="task-repositories-actions">
                {copy ? (
                  <>
                    <OpenInEditorButton companyId={company.id} path={copy.path} what={`the copy of ${repo.name}`} />
                    <OpenInEditorButton companyId={company.id} path={repo.path} what={`the original ${repo.name}`} label="Open original" />
                  </>
                ) : (
                  <OpenInEditorButton companyId={company.id} path={repo.path} what={repo.name} />
                )}
                {webUrls[repo.id] && <RepoSiteButton name={repo.name} webUrl={webUrls[repo.id] ?? ''} />}
              </span>
            </li>
          );
        })}
      </ul>
      {copies.length > 0 && (
        <button
          type="button"
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
      {error && <p className="error">{error}</p>}
    </section>
  );
}
