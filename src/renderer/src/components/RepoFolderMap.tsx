import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { RepoLayout } from '../../../shared/api';
import type { Company, Project } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { assignFolder, assignFolderToNewSubdomain, folderName, folderOwner } from '../lib/repo-folders';

type RepoFolderMapProps = {
  company: Company;
  project: Project;
  layout: RepoLayout | null;
  onSave: (company: Company) => Promise<void>;
};

const NEW_SUBDOMAIN = 'new';

export function RepoFolderMap({ company, project, layout, onSave }: RepoFolderMapProps) {
  const [typed, setTyped] = useState('');
  const [added, setAdded] = useState<string[]>([]);
  const { error, run } = useAction();

  const assigned = company.subdomains.flatMap((subdomain) => subdomain.folders.filter((folder) => folder.projectId === project.id).map((folder) => folder.path));
  const folders = [...new Set([...(layout?.folders ?? []), ...assigned, ...added])].sort();
  const nameIsFree = (name: string) => !company.subdomains.some((subdomain) => subdomain.name.toLowerCase() === name.toLowerCase());

  const choose = (path: string, value: string) =>
    run(() =>
      onSave(
        value === NEW_SUBDOMAIN
          ? assignFolderToNewSubdomain(company, project.id, path, { id: crypto.randomUUID(), name: folderName(path) })
          : assignFolder(company, project.id, path, value),
      ),
    );

  const addTyped = () => {
    const path = typed.trim().replace(/^\.\//, '').replace(/\/+$/, '');
    if (path) setAdded((current) => [...current, path]);
    setTyped('');
  };

  return (
    <div className="repo-folder-map">
      <p className="hint">Choose the area that owns each folder. The session opens at the top of the repository, and the agent focuses on the folders of the task&rsquo;s subdomain.</p>
      <ul>
        {folders.map((path) => (
          <li key={path}>
            <label>
              <code>{path}</code>
              <select aria-label={`Area for ${path}`} value={folderOwner(company, project.id, path)} onChange={(event) => void choose(path, event.target.value)}>
                <option value="">None</option>
                {company.subdomains.map((subdomain) => (
                  <option key={subdomain.id} value={subdomain.id}>
                    {subdomain.name}
                  </option>
                ))}
                {nameIsFree(folderName(path)) && <option value={NEW_SUBDOMAIN}>New: {folderName(path)}</option>}
              </select>
            </label>
          </li>
        ))}
      </ul>
      <div className="inline-form">
        <input aria-label={`Add a folder of ${project.name}`} placeholder="src/search" value={typed} onChange={(event) => setTyped(event.target.value)} />
        <button type="button" className="quiet" disabled={!typed.trim()} onClick={addTyped}>
          <Plus size={15} />
          Add folder
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
