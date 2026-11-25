import { GitBranch } from 'lucide-react';
import type { TaskOutput } from '../../../shared/api';
import type { Company, OutsideChanges, Task } from '../../../shared/schemas';
import { taskRepositories } from '../../../shared/work-repos';
import { useAction } from '../hooks/useAction';
import type { PanelSections } from '../hooks/usePanelSections';
import { useRepositoryLinks } from '../hooks/useRepositoryLinks';
import { fileInRepo, type RepoWork } from '../lib/agent-work';
import { api } from '../lib/api';
import { plural } from '../lib/text';
import { PanelSection } from './PanelSection';
import { RepositoryLinks } from './RepositoryLinks';

type AgentWorkProps = {
  task: Task;
  company: Company;
  /** The repositories with something created, changed or deleted, or with commits. */
  work: RepoWork[];
  /** The documents the agent wrote for the person. */
  documents: TaskOutput[];
  /** The files the agent wrote outside the repositories, such as in the knowledge folder. */
  outside: OutsideChanges;
  /** Whether the task has a notes file to open. */
  hasNotes: boolean;
  sections: PanelSections;
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

const count = (total: number) => (total > 0 ? <span className="hint">{total}</span> : null);

/** What the agent made in this task: its repositories, the files it changed in each, and the files it created. Everything opens in the editor. */
export function AgentWork({ task, company, work, documents, outside, hasNotes, sections }: AgentWorkProps) {
  const { error, run } = useAction();
  const repos = taskRepositories(company, task);
  const webUrls = useRepositoryLinks(company.id);
  const open = (path: string) => void run(() => api.openInEditor(company.id, path));
  const openOutside = (path: string) => void run(async () => void (await api.openTaskChangedFile(task.id, path)));
  const inRepo = (repo: RepoWork, files: string[]) => files.map((file) => ({ name: file, path: fileInRepo(repo.path, file) }));
  const created = work.filter((repo) => repo.created.length > 0);
  const changed = work.filter((repo) => repo.changed.length + repo.deleted.length > 0);
  const outsideFolders = outside.folders
    .map(({ folder, changes }) => ({ folder, files: changes.filter((change) => change.status !== 'deleted').map((change) => ({ name: change.path.startsWith(`${folder}/`) ? change.path.slice(folder.length + 1) : change.path, path: change.path })) }))
    .filter(({ files }) => files.length > 0);
  const changedCount = changed.reduce((total, repo) => total + repo.changed.length + repo.deleted.length, 0);
  const createdCount = documents.length + created.reduce((total, repo) => total + repo.created.length, 0) + outsideFolders.reduce((total, { files }) => total + files.length, 0);

  return (
    <>
      <PanelSection title="Repositories" className="agent-work-section" open={sections.isOpen('repositories')} onToggle={() => sections.toggle('repositories')} actions={count(repos.length)}>
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
                    <span className="hint" title={copy?.branch}>
                      {copy ? copy.branch : task.isolated ? 'reading' : 'shared folder'}
                    </span>
                  </span>
                  <RepositoryLinks companyId={company.id} path={copy?.path ?? repo.path} what={copy ? `the copy of ${repo.name}` : repo.name} name={repo.name} webUrl={webUrls[repo.id]} />
                </li>
              );
            })}
          </ul>
        )}
      </PanelSection>

      <PanelSection title="Files changed" className="agent-work-section" open={sections.isOpen('changed')} onToggle={() => sections.toggle('changed')} actions={count(changedCount)}>
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
      </PanelSection>

      <PanelSection title="Files created" className="agent-work-section" open={sections.isOpen('created')} onToggle={() => sections.toggle('created')} actions={count(createdCount)}>
        {createdCount === 0 && <p className="hint">The agent has not created any file yet.</p>}
        {hasNotes && (
          <p className="agent-work-notes">
            <button type="button" className="link-button" title="Open the notes file of this task in your editor" onClick={() => void run(async () => void (await api.openTaskNotesInEditor(task.id)))}>
              Task notes
            </button>
            <span className="hint">where the agent keeps the state of this task</span>
          </p>
        )}
        <FileLinks title="Documents for you" files={documents.map((document) => ({ name: document.name, path: document.path }))} onOpen={open} />
        {created.map((repo) => (
          <div key={repo.projectId} className="agent-work-repo" role="group" aria-label={`Created in ${repo.name}`}>
            <FileLinks title={repo.name} files={inRepo(repo, repo.created)} onOpen={open} />
          </div>
        ))}
        {outsideFolders.map(({ folder, files }) => (
          <div key={folder} className="agent-work-repo" role="group" aria-label={`Written in ${folder}`}>
            <FileLinks title={folder} files={files} onOpen={openOutside} />
          </div>
        ))}
        {outside.truncated && <p className="hint">Some folders are too large to follow in full, so files may be missing here.</p>}
      </PanelSection>
      {error && <p className="error">{error}</p>}
    </>
  );
}
