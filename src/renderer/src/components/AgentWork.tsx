import { GitBranch } from 'lucide-react';
import type { TaskOutput } from '../../../shared/api';
import type { Company, Task } from '../../../shared/schemas';
import { taskRepositories } from '../../../shared/work-repos';
import { useAction } from '../hooks/useAction';
import { fileInRepo, type RepoWork } from '../lib/agent-work';
import { api } from '../lib/api';
import { plural } from '../lib/text';
import { OpenInEditorButton } from './OpenInEditorButton';

type AgentWorkProps = {
  task: Task;
  company: Company;
  /** The repositories with something created, changed or deleted, or with commits. */
  work: RepoWork[];
  /** The documents the agent wrote for the person. */
  documents: TaskOutput[];
};

type FileLinksProps = { title: string; files: { name: string; path: string }[]; onOpen: (path: string) => void };

function FileLinks({ title, files, onOpen }: FileLinksProps) {
  if (files.length === 0) return null;
  return (
    <>
      <h4>
        {title} <span className="hint">{files.length}</span>
      </h4>
      <ul className="agent-work-files">
        {files.map((file) => (
          <li key={file.path}>
            <button type="button" className="link-button" title={`Open ${file.path} in your editor`} onClick={() => onOpen(file.path)}>
              {file.name}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** What the agent made in this task: its repositories, the files it changed in each, and the files it created. Everything opens in the editor. */
export function AgentWork({ task, company, work, documents }: AgentWorkProps) {
  const { error, run } = useAction();
  const repos = taskRepositories(company, task);
  const open = (path: string) => void run(() => api.openInEditor(company.id, path));
  const inRepo = (repo: RepoWork, files: string[]) => files.map((file) => ({ name: file, path: fileInRepo(repo.path, file) }));
  const created = work.filter((repo) => repo.created.length > 0);
  const changed = work.filter((repo) => repo.changed.length + repo.deleted.length > 0);

  return (
    <>
      <section className="agent-work-section" aria-label="Repositories">
        <h3>Repositories</h3>
        {repos.length === 0 ? (
          <p className="hint">No repository is selected for this task.</p>
        ) : (
          <ul className="agent-work-repos">
            {repos.map((repo) => {
              const copy = task.worktrees.find((worktree) => worktree.projectId === repo.id);
              return (
                <li key={repo.id}>
                  <span className="agent-work-repo-name">
                    {copy && <GitBranch size={12} />}
                    <strong>{repo.name}</strong>
                    <span className="hint">{copy ? copy.branch : task.isolated ? 'reading' : 'shared folder'}</span>
                  </span>
                  <OpenInEditorButton companyId={company.id} path={copy?.path ?? repo.path} what={copy ? `the copy of ${repo.name}` : repo.name} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="agent-work-section" aria-label="Files changed">
        <h3>Files changed</h3>
        {changed.length === 0 && <p className="hint">The agent has not changed any file yet.</p>}
        {changed.map((repo) => (
          <div key={repo.projectId} className="agent-work-repo" role="group" aria-label={`Changed in ${repo.name}`}>
            <p>
              <strong>{repo.name}</strong>
              {repo.commits > 0 && <span className="hint">{plural(repo.commits, 'commit', 'commits')}</span>}
            </p>
            <FileLinks title="Changed" files={inRepo(repo, repo.changed)} onOpen={open} />
            {repo.deleted.length > 0 && (
              <>
                <h4>
                  Deleted <span className="hint">{repo.deleted.length}</span>
                </h4>
                <ul className="agent-work-files">
                  {repo.deleted.map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ))}
      </section>

      <section className="agent-work-section" aria-label="Files created">
        <h3>Files created</h3>
        {created.length === 0 && documents.length === 0 && <p className="hint">The agent has not created any file yet.</p>}
        <FileLinks title="Documents for you" files={documents.map((document) => ({ name: document.name, path: document.path }))} onOpen={open} />
        {created.map((repo) => (
          <div key={repo.projectId} className="agent-work-repo" role="group" aria-label={`Created in ${repo.name}`}>
            <FileLinks title={repo.name} files={inRepo(repo, repo.created)} onOpen={open} />
          </div>
        ))}
        {error && <p className="error">{error}</p>}
      </section>
    </>
  );
}
