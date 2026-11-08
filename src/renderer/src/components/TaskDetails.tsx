import { Pencil } from 'lucide-react';
import { useState } from 'react';
import type { PlaybookSummary, Snapshot } from '../../../shared/api';
import { accountsForClient } from '../../../shared/accounts';
import type { Company, Task, TaskPatch } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { useEditorName } from '../hooks/useEditorName';
import { api } from '../lib/api';
import { AreaCreator } from './AreaCreator';
import { MarkdownField } from './MarkdownField';
import { TaskNotes } from './TaskNotes';
import { PrioritySelect } from './PrioritySelect';
import { RepoPicker } from './RepoPicker';
import { TaskChanges } from './TaskChanges';
import { TaskCode } from './TaskCode';
import { TaskIssueLink } from './TaskIssueLink';
import { workRepositories } from '../../../shared/work-repos';

type TaskDetailsProps = {
  snapshot: Snapshot;
  task: Task;
  company: Company;
  playbooks: PlaybookSummary[];
  notes: string;
  isLive: boolean;
  refreshKey: string;
  effectiveAccountId?: string;
  patch: (change: TaskPatch) => unknown;
  onGuideChange: (playbookId: string | null) => unknown;
  onChanged: () => Promise<void>;
};

export function TaskDetails({ snapshot, task, company, playbooks, notes, isLive, refreshKey, effectiveAccountId, patch, onGuideChange, onChanged }: TaskDetailsProps) {
  const editor = useAction();
  const editorName = useEditorName();
  const [description, setDescription] = useState(task.description);

  return (
    <div className="details-view">
      <section className="details-section details-settings" aria-label="Settings">
        <h3>Settings</h3>
        <div className="panel-fields">
          <label>
            Guide
            <select value={task.guide?.playbookId ?? ''} onChange={(event) => void onGuideChange(event.target.value || null)}>
              <option value="">No guide</option>
              {playbooks.map((playbook) => (
                <option key={playbook.id} value={playbook.id}>
                  {playbook.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Agent
            <select value={effectiveAccountId ?? ''} onChange={(event) => void patch({ accountId: event.target.value })}>
              {accountsForClient(snapshot.accounts.accounts, company.id).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ({account.label})
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <PrioritySelect value={task.priority} label="Priority" onChange={(priority) => void patch({ priority })} />
          </label>
          <div className="area-field">
            <label>
              Area
              <select value={task.subdomainId ?? company.defaultAreaId ?? ''} onChange={(event) => void patch({ subdomainId: event.target.value })}>
                {company.subdomains.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </select>
            </label>
            {company.subdomains.length === 0 && <AreaCreator companyId={company.id} onCreated={(subdomainId) => patch({ subdomainId })} />}
          </div>
          {workRepositories(company).length > 0 && (
            <label>
              Code
              <select value={task.isolated ? 'own' : 'shared'} onChange={(event) => void patch({ isolated: event.target.value === 'own' })}>
                <option value="own">Copy on change (uses a git worktree)</option>
                <option value="shared">Shared folder</option>
              </select>
            </label>
          )}
        </div>
        {isLive && <p className="hint">Changes to the agent or repositories apply to the next session.</p>}
        <TaskIssueLink task={task} onChanged={onChanged} />
      </section>

      <section className="details-section" aria-label="Notes and description">
        <h3>Description and notes</h3>
        <div className="notes">
          <span>About this task</span>
          <MarkdownField
            label="About this task"
            value={description}
            placeholder="What this task is about. The agent reads it when a session starts."
            onChange={setDescription}
            onCommit={(text) => {
              if (text !== task.description) void patch({ description: text });
            }}
          />
        </div>
        <section className="notes-view" aria-label="Where it stands">
          <div className="overview-head">
            <strong>Where it stands</strong>
            <button className="quiet" disabled={editor.busy} onClick={() => void editor.run(async () => void (await api.openTaskNotesInEditor(task.id)))}>
              <Pencil size={14} />
              {editorName ? `Edit in ${editorName}` : 'Edit in your editor'}
            </button>
          </div>
          <TaskNotes notes={notes} empty="State of the work and the next step. The agent keeps this current, and any agent can continue from it." />
          {editor.error && <p className="error">{editor.error}</p>}
        </section>
      </section>

      <section className="details-section" aria-label="Repositories">
        {workRepositories(company).length > 0 && <RepoPicker company={company} selected={task.projectIds} changing={task.worktrees.map((worktree) => worktree.projectId)} onChange={(projectIds) => void patch({ projectIds })} />}
        <TaskCode task={task} company={company} isLive={isLive} onChanged={onChanged} />
      </section>

      <section className="details-section details-changes" aria-label="Changes">
        <TaskChanges task={task} refreshKey={refreshKey} />
      </section>
    </div>
  );
}
