import { useState } from 'react';
import type { Company } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { PathPicker } from './PathPicker';
import { ProjectTable } from './ProjectTable';
import { RepoDownload } from './RepoDownload';
import { RepoFolderImport } from './RepoFolderImport';
import { RepoLinkDownload } from './RepoLinkDownload';

type RepositoriesStepProps = {
  company: Company;
  defaultFolder: string | undefined;
  onSave: (company: Company) => Promise<void>;
  onChanged: () => Promise<void>;
};

export function RepositoriesStep({ company, defaultFolder, onSave, onChanged }: RepositoriesStepProps) {
  const { error, busy, run } = useAction();
  const [mode, setMode] = useState<'download' | 'folder'>(company.origin === 'scratch' || company.gitSource ? 'download' : 'folder');

  return (
    <div className="repo-groups">
      <section className="repo-group" aria-labelledby="repo-group-add">
        <header>
          <h3 id="repo-group-add">Add repositories</h3>
          <p className="hint">Download them, or point Hatstand to the ones already on this computer.</p>
        </header>
        <fieldset className="source-choice">
          <legend className="visually-hidden">How to add repositories</legend>
          <label>
            <input type="radio" name="repo-source" checked={mode === 'download'} onChange={() => setMode('download')} />
            <span>
              Download from GitHub or GitLab
              <small>Hatstand lists the company&rsquo;s repositories and clones the ones you choose.</small>
            </span>
          </label>
          <label>
            <input type="radio" name="repo-source" checked={mode === 'folder'} onChange={() => setMode('folder')} />
            <span>
              Use a folder I already have
              <small>Your repositories stay where they are.</small>
            </span>
          </label>
        </fieldset>
        {mode === 'download' ? (
          <div key="download" className="repo-group-body motion-enter">
            <RepoDownload company={company} />
            <RepoLinkDownload company={company} />
          </div>
        ) : (
          <div key="folder" className="repo-group-body motion-enter">
            <RepoFolderImport company={company} onSave={onSave} />
          </div>
        )}
      </section>
      <section className="repo-group" aria-labelledby="repo-group-list">
        <header>
          <h3 id="repo-group-list">
            Repositories of this client
            <span className="board-count">{company.projects.length}</span>
          </h3>
          <p className="hint">The area of a repository decides which tasks suggest it.</p>
        </header>
        {company.projects.length === 0 && <p className="hint">None yet. The ones you add above show up here.</p>}
        <ProjectTable company={company} onSave={onSave} onChanged={onChanged} />
      </section>
      <section className="repo-group" aria-labelledby="repo-group-folder">
        <header>
          <h3 id="repo-group-folder">Client folder</h3>
          <p className="hint">Sessions start here, with every repository inside it in reach.</p>
        </header>
        {company.rootDir && <p className="path">{company.rootDir}</p>}
        <PathPicker
          kind="directory"
          label="Client folder"
          browseLabel={company.rootDir ? 'Change folder' : 'Choose folder'}
          onSelect={(dir) => onSave({ ...company, rootDir: dir })}
        />
        {defaultFolder && company.rootDir !== defaultFolder && (
          <p className="file-row">
            <span className="hint">Default: {defaultFolder}</span>
            <button className="quiet" disabled={busy} onClick={() => void run(() => api.resetClientFolder(company.id))}>
              Use default folder
            </button>
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </section>
    </div>
  );
}
