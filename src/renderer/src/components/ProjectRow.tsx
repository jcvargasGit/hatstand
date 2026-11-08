import type { Company, Project } from '../../../shared/schemas';
import { isControlRepo } from '../../../shared/work-repos';
import { useAction } from '../hooks/useAction';
import { useFolderSwitch } from '../hooks/useFolderSwitch';
import { useRepoLayout } from '../hooks/useRepoLayout';
import { api } from '../lib/api';
import { assignWholeRepo, removeRepo, splitRepo } from '../lib/repo-folders';
import { plural } from '../lib/text';
import { FolderSwitchWarning } from './FolderSwitchWarning';
import { RepoFolderMap } from './RepoFolderMap';

type ProjectRowProps = {
  company: Company;
  project: Project;
  onSave: (company: Company) => Promise<void>;
  onChanged: () => Promise<void>;
};

const BY_FOLDER = 'by-folder';

export function ProjectRow({ company, project, onSave, onChanged }: ProjectRowProps) {
  const layout = useRepoLayout(company.id, project.id);
  const { error, run } = useAction();
  const folderSwitch = useFolderSwitch(company.id, 'planning', async () => {
    await api.setPlanningRepo(company.id, project.path);
    await onChanged();
  });
  const undecided = !project.subdomainId && !project.splitByFolder;
  const isControl = isControlRepo(company, project);

  const choose = (value: string) =>
    run(() => onSave(value === BY_FOLDER ? splitRepo(company, project.id) : assignWholeRepo(company, project.id, value || undefined)));

  return (
    <>
      <tr>
        <td title={project.path}>{project.name}</td>
        <td>
          <select aria-label={`Area for ${project.name}`} value={project.splitByFolder ? BY_FOLDER : (project.subdomainId ?? '')} onChange={(event) => void choose(event.target.value)}>
            <option value="">None</option>
            {company.subdomains.map((subdomain) => (
              <option key={subdomain.id} value={subdomain.id}>
                {subdomain.name}
              </option>
            ))}
            <option value={BY_FOLDER}>Several, by folder</option>
          </select>
        </td>
        <td className="project-row-actions">
          {isControl ? (
            <span className="repo-chip" title="Agents can read it, but tasks do not change it.">Context only</span>
          ) : (
            <button
              className="quiet"
              title="Moves it out of Repositories. Tasks stop using it, and it no longer gets commit protection."
              disabled={folderSwitch.busy}
              onClick={() => void folderSwitch.run(() => folderSwitch.switchTo(project.path))}
            >
              Use for planning
            </button>
          )}
          {folderSwitch.pending && <FolderSwitchWarning pending={folderSwitch.pending} defaultPath={undefined} busy={folderSwitch.busy} onConfirm={folderSwitch.confirm} onCancel={folderSwitch.cancel} />}
          {folderSwitch.error && <p className="error">{folderSwitch.error}</p>}
          <button className="quiet" onClick={() => void run(() => onSave(removeRepo(company, project.id)))}>
            Remove
          </button>
        </td>
      </tr>
      {undecided && layout?.isMonorepo && (
        <tr>
          <td colSpan={3} className="repo-layout-notice">
            <span>
              This looks like a monorepo{layout.tool ? ` (${layout.tool})` : ''}, with {plural(layout.folders.length, 'folder', 'folders')}.
            </span>
            <button className="quiet" onClick={() => void choose(BY_FOLDER)}>
              Split by folder
            </button>
          </td>
        </tr>
      )}
      {project.splitByFolder && (
        <tr>
          <td colSpan={3}>
            <RepoFolderMap company={company} project={project} layout={layout} onSave={onSave} />
          </td>
        </tr>
      )}
      {error && (
        <tr>
          <td colSpan={3}>
            <p className="error">{error}</p>
          </td>
        </tr>
      )}
    </>
  );
}
