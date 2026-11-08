import { useState } from 'react';
import type { Company, Project } from '../../../shared/schemas';
import { api } from '../lib/api';
import { plural } from '../lib/text';
import { PathPicker } from './PathPicker';

type RepoFolderImportProps = {
  company: Company;
  onSave: (company: Company) => Promise<void>;
};

export function RepoFolderImport({ company, onSave }: RepoFolderImportProps) {
  const [message, setMessage] = useState<string | null>(null);

  const importFolder = async (dir: string) => {
    const known = new Set(company.projects.map((project) => project.path));
    const found = await api.scanRepos(dir);
    const fresh = found.filter((repo) => !known.has(repo.path));
    const added: Project[] = fresh.map((repo) => ({ id: crypto.randomUUID(), name: repo.name, path: repo.path }));
    await onSave({ ...company, rootDir: company.rootDir ?? dir, projects: [...company.projects, ...added] });
    setMessage(
      found.length === 0
        ? `No git repositories found in ${dir}.`
        : `Found ${plural(found.length, 'repository', 'repositories')} and added ${added.length}.`,
    );
  };

  return (
    <div className="field-block">
      <p className="hint">Choose a folder and Hatstand adds every git repository it finds inside.</p>
      <PathPicker
        kind="directory"
        label="Folder with your repositories"
        browseLabel="Add repositories from a folder"
        onSelect={importFolder}
      />
      {message && <p className="hint">{message}</p>}
    </div>
  );
}
