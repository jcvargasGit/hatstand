import { Play, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { Snapshot } from '../../../shared/api';
import { hasWorkspace } from '../../../shared/readiness';
import { starterGuideId } from '../../../shared/task-types';
import { useAction } from '../hooks/useAction';
import { usePlaybooks } from '../hooks/usePlaybooks';
import { api } from '../lib/api';
import { sharedSubdomain } from '../lib/today';
import { AreaCreator } from './AreaCreator';
import { MarkdownField } from './MarkdownField';
import { RepoPicker } from './RepoPicker';
import { suggestedRepositoryIds, workRepositories } from '../../../shared/work-repos';

type NewTaskPageProps = {
  snapshot: Snapshot;
  initialCompanyId: string | null;
  initialAreaId?: string;
  onCreated: (taskId: string, companyId: string) => Promise<void>;
  onChanged: () => Promise<void>;
};

export function NewTaskPage({ snapshot, initialCompanyId, initialAreaId, onCreated, onChanged }: NewTaskPageProps) {
  const findCompany = (id: string) => snapshot.companies.find((item) => item.id === id);
  const suggestRepositories = (id: string, areaId?: string) => {
    const client = findCompany(id);
    return client ? suggestedRepositoryIds(client, areaId) : [];
  };
  const [companyId, setCompanyId] = useState(initialCompanyId ?? snapshot.companies[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectIds, setProjectIds] = useState<string[]>(() => suggestRepositories(companyId, initialAreaId));
  const [guideChoice, setGuideChoice] = useState<string | null>(null);
  const [isolated, setIsolated] = useState(true);
  const [chosenAreaId, setChosenAreaId] = useState<string | null>(initialAreaId ?? null);
  const { playbooks } = usePlaybooks(companyId);
  const { error, busy, run } = useAction();
  const company = findCompany(companyId);
  const canStart = company !== undefined && hasWorkspace(company);
  const starterGuide = snapshot.guideNewTasks && company ? starterGuideId(company) : undefined;
  const availableGuide = (id?: string) => playbooks.find((playbook) => playbook.id === id)?.id;
  const playbookId = guideChoice ?? availableGuide(company?.defaultPlaybookId) ?? availableGuide(starterGuide) ?? '';
  const noGuideHint = company && workRepositories(company).length > 0 ? 'Counts as code work, up to a merged pull request.' : 'Goes from not started to done.';
  const guideHint = playbookId ? playbooks.find((playbook) => playbook.id === playbookId)?.description : noGuideHint;
  const areaId = chosenAreaId ?? (company && sharedSubdomain(company, projectIds)) ?? company?.defaultAreaId ?? '';
  const focusFolders = company?.subdomains.find((area) => area.id === areaId)?.folders ?? [];

  const create = (startNow: boolean) =>
    run(async () => {
      if (!company || !title.trim()) return;
      const task = await api.createTask({
        companyId,
        title: title.trim(),
        description: description.trim() || undefined,
        projectIds,
        subdomainId: areaId || undefined,
        playbookId: playbookId || undefined,
        isolated,
      });
      if (startNow) await api.startSession(task.id);
      await onCreated(task.id, companyId);
    });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void create(canStart);
  };

  return (
    <main className="page">
      <form className="new-task-form" onSubmit={submit}>
        <h1>New task</h1>
        <label className="stacked-field">
          Client
          <select
            value={companyId}
            onChange={(event) => {
              setCompanyId(event.target.value);
              setProjectIds(suggestRepositories(event.target.value));
              setGuideChoice(null);
              setChosenAreaId(null);
            }}
          >
            {snapshot.companies.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="stacked-field">
          Task title
          <input autoFocus placeholder="What needs doing?" value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <div className="stacked-field">
          <span>Description</span>
          <MarkdownField label="Description" placeholder="Optional. Context the agent should know." value={description} onChange={setDescription} />
        </div>
        <label className="stacked-field">
          Guide
          <select value={playbookId} onChange={(event) => setGuideChoice(event.target.value)}>
            <option value="">No guide</option>
            {playbooks.map((playbook) => (
              <option key={playbook.id} value={playbook.id}>
                {playbook.name}
              </option>
            ))}
          </select>
          {guideHint && <small className="hint">{guideHint}</small>}
        </label>
        {company && (
          <div className="area-field">
            <label className="stacked-field">
              Area
              <select
                value={areaId}
                onChange={(event) => {
                  setChosenAreaId(event.target.value);
                  setProjectIds(suggestedRepositoryIds(company, event.target.value));
                }}
              >
                {company.subdomains.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </select>
              {focusFolders.length > 0 && <small className="hint">The agent focuses on {focusFolders.map((folder) => folder.path).join(', ')}.</small>}
            </label>
            {company.subdomains.length === 0 && (
              <AreaCreator
                companyId={company.id}
                onCreated={async (createdAreaId) => {
                  await onChanged();
                  setChosenAreaId(createdAreaId);
                }}
              />
            )}
          </div>
        )}
        {company && workRepositories(company).length > 0 && <RepoPicker key={company.id} company={company} selected={projectIds} onChange={setProjectIds} />}
        {company && workRepositories(company).length > 0 && (
          <label className="stacked-field">
            Code
            <select value={isolated ? 'own' : 'shared'} onChange={(event) => setIsolated(event.target.value === 'own')}>
              <option value="own">Copy on change (uses a git worktree)</option>
              <option value="shared">Shared folder</option>
            </select>
            <small className="hint">
              {isolated
                ? 'If the agent needs to change a repository, it makes a copy on its own branch (a git worktree).'
                : 'No copy and no branch. The agent works in the client’s folder, so other tasks can change the same files.'}
            </small>
          </label>
        )}
        {company && !canStart && <p className="warning">Add an area, a repository or a client folder to {company.name} before starting a session.</p>}
        {error && <p className="error">{error}</p>}
        <div className="inline-form">
          {canStart && (
            <button type="submit" disabled={busy || !title.trim()}>
              <Play size={14} />
              Create and start session
            </button>
          )}
          <button type="button" className={canStart ? 'quiet' : undefined} disabled={busy || !title.trim()} onClick={() => void create(false)}>
            <Plus size={15} />
            Create task
          </button>
        </div>
        {canStart && <p className="hint">The agent opens with a prompt already written, from the guide if you chose one. Press Enter to send it, or change it first.</p>}
      </form>
    </main>
  );
}
