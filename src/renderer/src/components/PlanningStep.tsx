import { Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { workRepositories } from '../../../shared/work-repos';
import type { Company, PlanningPlace } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { useFolderSwitch } from '../hooks/useFolderSwitch';
import { api } from '../lib/api';
import { ActiveFolder } from './ActiveFolder';
import { FolderSwitchWarning } from './FolderSwitchWarning';

type PlanningStepProps = {
  company: Company;
  defaultPath: string | undefined;
  onSave: (company: Company) => Promise<void>;
  onChanged: () => Promise<void>;
};

const isComplete = (place: PlanningPlace) => place.name.trim() !== '' && place.folder.trim() !== '';

export function PlanningStep({ company, defaultPath, onSave, onChanged }: PlanningStepProps) {
  const planning = company.planning;
  const [places, setPlaces] = useState<PlanningPlace[]>(planning?.places ?? []);
  const [folders, setFolders] = useState<string[]>([]);
  const repos = workRepositories(company);
  const [repoId, setRepoId] = useState('');
  const chosenRepo = repos.find((repo) => repo.id === repoId) ?? repos[0];
  const wasMoved = planning !== undefined && !company.projects.some((repo) => planning.path === repo.path || planning.path.startsWith(`${repo.path}/`));
  const { error, run } = useAction();
  const useFolder = async (path?: string) => {
    if (path) {
      await api.setPlanningRepo(company.id, path);
      await onChanged();
    } else {
      await onSave({ ...company, planning: undefined });
    }
  };
  const repoSwitch = useFolderSwitch(company.id, 'planning', useFolder);
  const createSwitch = useFolderSwitch(company.id, 'planning', async (path) => {
    if (!path) return;
    await api.createPlanningRepo(company.id, path);
    await onChanged();
  });
  const [newFolder, setNewFolder] = useState('');
  const hasPlanning = planning !== undefined;

  useEffect(() => {
    if (hasPlanning) return;
    let active = true;
    void api
      .defaultPlanningFolder(company.id)
      .catch(() => '')
      .then((found) => {
        if (active) setNewFolder(found ?? '');
      });
    return () => {
      active = false;
    };
  }, [company.id, hasPlanning]);

  useEffect(() => {
    setPlaces(planning?.places ?? []);
    let active = true;
    void api
      .listPlanningFolders(company.id)
      .catch(() => [])
      .then((found) => {
        if (active) setFolders(found ?? []);
      });
    return () => {
      active = false;
    };
  }, [company.id, planning?.path, planning?.places]);

  const savePlaces = (next: PlanningPlace[]) => {
    if (planning) void run(() => onSave({ ...company, planning: { ...planning, places: next.filter(isComplete) } }));
  };
  const edit = (index: number, change: Partial<PlanningPlace>) =>
    setPlaces((current) => current.map((place, position) => (position === index ? { ...place, ...change } : place)));
  const remove = (index: number) => {
    const next = places.filter((_place, position) => position !== index);
    setPlaces(next);
    savePlaces(next);
  };

  return (
    <>
      <ActiveFolder
        companyId={company.id}
        section="planning"
        title="Planning folder"
        hint="Hatstand created the default folder for you. It is private and has no git. Use a custom folder to work from your team's repository. Only one is active."
        defaultPath={defaultPath}
        customPath={planning?.path}
        onChange={useFolder}
      />
      {!planning && (
        <form
          className="field-block"
          onSubmit={(event) => {
            event.preventDefault();
            void createSwitch.run(() => createSwitch.switchTo(newFolder));
          }}
        >
          <h3>Or create a planning repository</h3>
          <p className="hint">Hatstand creates a git repository with folders for specs and decisions, and a template for each. It makes the first commit with the git email of that folder.</p>
          <div className="inline-form planning-new-repo">
            <input aria-label="Folder for the new planning repository" spellCheck={false} value={newFolder} onChange={(event) => setNewFolder(event.target.value)} />
            <button disabled={createSwitch.busy || !newFolder}>Create repository</button>
          </div>
          <p className="hint">It stays on this computer, with no backup, until you add a remote and push.</p>
          {createSwitch.pending && <FolderSwitchWarning pending={createSwitch.pending} defaultPath={defaultPath} busy={createSwitch.busy} onConfirm={createSwitch.confirm} onCancel={createSwitch.cancel} />}
          {createSwitch.error && <p className="error">{createSwitch.error}</p>}
        </form>
      )}
      <div className="field-block">
        {chosenRepo && (
          <div className="inline-form planning-from-repos">
            <select aria-label="Repository to use for planning" value={chosenRepo.id} onChange={(event) => setRepoId(event.target.value)}>
              {repos.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.name}
                </option>
              ))}
            </select>
            <button
              className="quiet"
              disabled={repoSwitch.busy}
              onClick={() => void repoSwitch.run(() => repoSwitch.switchTo(chosenRepo.path))}
            >
              Use this repository for planning
            </button>
          </div>
        )}
        {chosenRepo && <p className="hint">Or choose one you already added. It moves out of Repositories, so tasks stop using it, and it no longer gets commit protection.</p>}
        {repoSwitch.pending && <FolderSwitchWarning pending={repoSwitch.pending} defaultPath={defaultPath} busy={repoSwitch.busy} onConfirm={repoSwitch.confirm} onCancel={repoSwitch.cancel} />}
        {repoSwitch.error && <p className="error">{repoSwitch.error}</p>}
        {planning && wasMoved && (
          <div className="inline-form">
            <button
              className="quiet"
              title="Planning goes back to the default folder."
              onClick={() =>
                void run(() =>
                  onSave({
                    ...company,
                    planning: undefined,
                    projects: [...company.projects, { id: crypto.randomUUID(), name: planning.path.split('/').filter(Boolean).at(-1) ?? planning.path, path: planning.path }],
                  }),
                )
              }
            >
              Move back to Repositories
            </button>
          </div>
        )}
      </div>
      {planning && (
        <div className="field-block">
          <h3>Where each thing goes</h3>
          <p className="hint">Hatstand filled in what it recognized. Change the names and folders to match how your team works.</p>
          <datalist id="planning-folders">
            {folders.map((folder) => (
              <option key={folder} value={folder} />
            ))}
          </datalist>
          <ul className="planning-places">
            {places.map((place, index) => (
              <li key={index}>
                <input aria-label={`Name of place ${index + 1}`} placeholder="Tickets" value={place.name} onChange={(event) => edit(index, { name: event.target.value })} onBlur={() => savePlaces(places)} />
                <input aria-label={`Folder of place ${index + 1}`} list="planning-folders" placeholder="tickets" value={place.folder} onChange={(event) => edit(index, { folder: event.target.value })} onBlur={() => savePlaces(places)} />
                <button className="quiet" aria-label={`Remove place ${index + 1}`} onClick={() => remove(index)}>
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
          <button className="quiet" onClick={() => setPlaces((current) => [...current, { name: '', folder: '' }])}>
            <Plus size={15} />
            Add a place
          </button>
          <p className="hint">Agents are told not to commit or push here unless you ask. This repository has no commit protection, because what it holds may need to be committed.</p>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </>
  );
}
