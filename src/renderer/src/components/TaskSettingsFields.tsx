import { FolderGit2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { PlaybookSummary, Snapshot } from '../../../shared/api';
import { accountsForClient } from '../../../shared/accounts';
import type { Company } from '../../../shared/schemas';
import { workRepositories } from '../../../shared/work-repos';
import { orderGuidesByUse, type TaskChoices } from '../lib/task-form';
import { AreaCreator } from './AreaCreator';
import { PrioritySelect } from './PrioritySelect';
import { RepoDialog } from './RepoDialog';

type TaskSettingsFieldsProps = {
  snapshot: Snapshot;
  company: Company | undefined;
  choices: TaskChoices;
  playbooks: PlaybookSummary[];
  /** The clients to choose from. Without them, the client is fixed. */
  clients?: Company[];
  /** Repositories with a copy of the code, which stay selected. */
  changing?: string[];
  note?: string;
  /** Shown under the guide, such as the step the task is on. */
  guideStep?: ReactNode;
  children?: ReactNode;
  onChange: (change: Partial<TaskChoices>) => void;
  onAreaCreated: (areaId: string) => unknown;
};

/** Client, guide, area, agent, priority, code and repositories: the settings beside the description of a task. */
export function TaskSettingsFields({ snapshot, company, choices, playbooks, clients, changing = [], note, guideStep, children, onChange, onAreaCreated }: TaskSettingsFieldsProps) {
  const [choosingRepos, setChoosingRepos] = useState(false);
  const guides = orderGuidesByUse(playbooks, snapshot.guideUsage ?? {});
  const repos = company ? workRepositories(company) : [];
  const selectedRepos = repos.filter((repo) => choices.projectIds.includes(repo.id));
  const guide = playbooks.find((playbook) => playbook.id === choices.playbookId);
  const noGuideHint = repos.length > 0 ? 'Counts as code work, up to a merged pull request.' : 'Goes from not started to done.';
  const focusFolders = company?.subdomains.find((area) => area.id === choices.areaId)?.folders ?? [];

  return (
    <div className="task-settings-fields">
      {clients && (
        <label className="stacked-field">
          Client
          <select value={choices.companyId} onChange={(event) => onChange({ companyId: event.target.value })}>
            {clients.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="stacked-field">
        Guide
        <select value={choices.playbookId} onChange={(event) => onChange({ playbookId: event.target.value })}>
          <option value="">No guide</option>
          {guides.map((playbook) => (
            <option key={playbook.id} value={playbook.id}>
              {playbook.name}
            </option>
          ))}
        </select>
        <small className="hint">{guide ? guide.description : noGuideHint}</small>
      </label>
      {guideStep}
      {company && (
        <div className="area-field">
          <label className="stacked-field">
            Area
            <select value={choices.areaId} onChange={(event) => onChange({ areaId: event.target.value })}>
              {company.subdomains.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
            </select>
            {focusFolders.length > 0 && <small className="hint">The agent focuses on {focusFolders.map((folder) => folder.path).join(', ')}.</small>}
          </label>
          {company.subdomains.length === 0 && <AreaCreator companyId={company.id} onCreated={onAreaCreated} />}
        </div>
      )}
      {company && (
        <label className="stacked-field">
          Agent
          <select value={choices.accountId} onChange={(event) => onChange({ accountId: event.target.value })}>
            {accountsForClient(snapshot.accounts.accounts, company.id).map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.label})
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="stacked-field">
        Priority
        <PrioritySelect value={choices.priority} label="Priority" onChange={(priority) => onChange({ priority })} />
      </label>
      {company && repos.length > 0 && (
        <>
          <div className="stacked-field task-repos-field" role="group" aria-label="Chosen repositories">
            <span>Repositories</span>
            {selectedRepos.length === 0 ? (
              <span className="hint">None selected. The agent starts in the client folder.</span>
            ) : (
              <ul className="task-repo-chips">
                {selectedRepos.map((repo) => (
                  <li key={repo.id} title={repo.path}>
                    <FolderGit2 size={13} />
                    {repo.name}
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="quiet" onClick={() => setChoosingRepos(true)}>
              {selectedRepos.length === 0 ? 'Choose repositories' : 'Change repositories'}
            </button>
          </div>
          <label className="stacked-field">
            Code
            <select value={choices.isolated ? 'own' : 'shared'} onChange={(event) => onChange({ isolated: event.target.value === 'own' })}>
              <option value="own">Copy on change (uses a git worktree)</option>
              <option value="shared">Shared folder</option>
            </select>
            <small className="hint">
              {choices.isolated
                ? 'If the agent needs to change a repository, it makes a copy on its own branch (a git worktree).'
                : 'No copy and no branch. The agent works in the client’s folder, so other tasks can change the same files.'}
            </small>
          </label>
        </>
      )}
      {children}
      {note && <p className="hint">{note}</p>}
      {choosingRepos && company && (
        <RepoDialog company={company} selected={choices.projectIds} changing={changing} onChoose={(projectIds) => onChange({ projectIds })} onClose={() => setChoosingRepos(false)} />
      )}
    </div>
  );
}
