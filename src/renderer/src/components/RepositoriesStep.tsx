import { useState } from 'react';
import type { Company } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { PathPicker } from './PathPicker';
import { ProjectTable } from './ProjectTable';
import { RepoDownload } from './RepoDownload';
import { RepoFolderImport } from './RepoFolderImport';

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
    <>
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
      {mode === 'download' ? <RepoDownload company={company} /> : <RepoFolderImport company={company} onSave={onSave} />}
      <ProjectTable company={company} onSave={onSave} onChanged={onChanged} />
      <div className="field-block">
        <h3>Client folder</h3>
        <p className="hint">Sessions start here, with every repository inside it in reach.</p>
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
      </div>
    </>
  );
}
