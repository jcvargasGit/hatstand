import { ArrowRight, ExternalLink, Play, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Snapshot } from '../../../shared/api';
import type { NewTaskDraft } from '../../../shared/new-task-draft';
import { hasWorkspace } from '../../../shared/readiness';
import { suggestedRepositoryIds } from '../../../shared/work-repos';
import { useAction } from '../hooks/useAction';
import { useDraftSaving } from '../hooks/useDraftSaving';
import { usePlaybooks } from '../hooks/usePlaybooks';
import { api } from '../lib/api';
import { startDraft } from '../lib/new-task-draft';
import { suggestions } from '../lib/suggestion-store';
import { suggestedArea, suggestedGuide, type TaskChoices } from '../lib/task-form';
import { TaskForm } from './TaskForm';
import { TaskSettingsFields } from './TaskSettingsFields';

type NewTaskPageProps = {
  snapshot: Snapshot;
  /** What the form starts with: empty, a backlog item, a draft saved in the backlog, or a form moved from the side panel. */
  initialDraft: NewTaskDraft;
  /** Told every change, so a window of its own can keep the draft safe. */
  onDraftChange?: (draft: NewTaskDraft) => void;
  /** Moves the form to a window of its own. Without it, the form is already in one. */
  onMoveToWindow?: (draft: NewTaskDraft) => Promise<void>;
  onClose?: () => void;
  onCreated: (taskId: string, companyId: string) => Promise<void>;
  onChanged: () => Promise<void>;
};

const WAITS_FOR_ENTER = 'The agent opens with a prompt already written, from the guide if you chose one. Press Enter to send it, or change it first.';
const STARTS_AT_ONCE = 'The agent starts working on the task as soon as the session opens. A step that needs your approval still waits for you.';

/** Writes a task: a new one, or a backlog item that becomes one. It opens in the side panel, and can move to a window of its own. */
export function NewTaskPage({ snapshot, initialDraft, onDraftChange, onMoveToWindow, onClose, onCreated, onChanged }: NewTaskPageProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [suggestionKey] = useState(() => initialDraft.ideaId ?? initialDraft.suggestionKey ?? `new-task-${crypto.randomUUID()}`);
  const { playbooks } = usePlaybooks(draft.companyId);
  const { error, busy, run } = useAction();
  const company = snapshot.companies.find((item) => item.id === draft.companyId);
  const canStart = company !== undefined && hasWorkspace(company);
  const isIdea = draft.ideaId !== undefined;
  const guideStillThere = draft.playbookId === '' || playbooks.some((playbook) => playbook.id === draft.playbookId);
  const current: TaskChoices = {
    ...draft,
    playbookId: draft.guideChosen && guideStillThere ? draft.playbookId : suggestedGuide(snapshot, company, playbooks),
    areaId: draft.areaChosen ? draft.areaId : suggestedArea(company, draft.projectIds),
  };

  const form = useMemo(() => ({ ...draft, suggestionKey }), [draft, suggestionKey]);
  const saving = useDraftSaving(form, !isIdea);
  const { draftId } = saving;

  useEffect(() => {
    onDraftChange?.({ ...form, draftId: draftId ?? undefined });
  }, [form, draftId, onDraftChange]);

  const change = (next: Partial<TaskChoices>) => {
    if (next.companyId !== undefined && next.companyId !== draft.companyId) {
      setDraft({ ...startDraft(snapshot, next.companyId), title: draft.title, description: draft.description });
      return;
    }
    const projectIds = next.areaId !== undefined && company ? suggestedRepositoryIds(company, next.areaId) : next.projectIds;
    setDraft((previous) => ({
      ...previous,
      ...next,
      ...(projectIds ? { projectIds } : {}),
      guideChosen: previous.guideChosen || next.playbookId !== undefined,
      areaChosen: previous.areaChosen || next.areaId !== undefined,
    }));
  };

  const save = async (): Promise<string> => {
    const choices = {
      title: draft.title.trim(),
      projectIds: current.projectIds,
      subdomainId: current.areaId || undefined,
      playbookId: current.playbookId || undefined,
      accountId: current.accountId || undefined,
      isolated: current.isolated,
      priority: current.priority,
    };
    const savedId = draft.ideaId ?? (await saving.finish());
    if (savedId) return (await api.makeTask(savedId, { ...choices, description: draft.description })).id;
    return (await api.createTask({ ...choices, companyId: current.companyId, description: draft.description.trim() || undefined })).id;
  };

  const create = (startNow: boolean) =>
    run(async () => {
      if (!company || !draft.title.trim()) return;
      const taskId = await save().catch((caught: unknown) => {
        saving.resume();
        throw caught;
      });
      suggestions.drop(suggestionKey);
      if (startNow) await api.startSession(taskId);
      await onCreated(taskId, current.companyId);
    });

  const discard = () =>
    run(async () => {
      const savedId = await saving.stop();
      suggestions.drop(suggestionKey);
      if (savedId) await api.deleteTask(savedId);
      await onChanged();
      onClose?.();
    });

  return (
    <section className="panel new-task-panel">
      <header className="panel-head">
        <div className="panel-title">
          <h2>{isIdea ? 'Make it a task' : 'New task'}</h2>
        </div>
        <div className="panel-actions">
          {onMoveToWindow && (
            <button type="button" className="quiet" title="Keep writing in a window of its own. Nothing you wrote is lost." disabled={busy} onClick={() => void run(async () => onMoveToWindow({ ...form, draftId: (await saving.flush()) ?? undefined }))}>
              <ExternalLink size={14} />
              Open in new window
            </button>
          )}
          {onClose && (
            <button type="button" className="quiet" aria-label="Close" title="Close" onClick={onClose}>
              <X size={14} />
            </button>
          )}
        </div>
      </header>
      <TaskForm
        label={isIdea ? 'Backlog item to task' : 'New task'}
        title={{ value: draft.title, autoFocus: true, onChange: (title) => setDraft((previous) => ({ ...previous, title })) }}
        description={draft.description}
        improveRequest={{ key: suggestionKey, companyId: current.companyId, title: draft.title.trim(), description: draft.description, subdomainId: current.areaId || undefined, projectIds: current.projectIds }}
        improveDisabledReason={company ? undefined : 'Choose a client first.'}
        onDescriptionChange={(description) => setDraft((previous) => ({ ...previous, description }))}
        onSubmit={() => void create(canStart)}
        settings={
          <TaskSettingsFields
            snapshot={snapshot}
            company={company}
            choices={current}
            playbooks={playbooks}
            clients={isIdea ? undefined : snapshot.companies}
            onChange={change}
            onAreaCreated={async (areaId) => {
              await onChanged();
              setDraft((previous) => ({ ...previous, areaId, areaChosen: true }));
            }}
          />
        }
        actions={
          <>
            {company && !canStart && <p className="warning">Add an area, a repository or a client folder to {company.name} before starting a session.</p>}
            {error && <p className="error">{error}</p>}
            {draftId && <p className="hint draft-saved">Saved as a draft in the backlog of {company?.name ?? 'this client'}. You can leave and continue later.</p>}
            {canStart && <p className="hint">{snapshot.autoSendPrompt ? STARTS_AT_ONCE : WAITS_FOR_ENTER}</p>}
            {draftId && onClose && (
              <button type="button" className="quiet" disabled={busy} title="Deletes this draft from the backlog." onClick={() => void discard()}>
                <Trash2 size={14} />
                Discard draft
              </button>
            )}
            <button type="button" className={canStart ? 'quiet' : undefined} disabled={busy || !draft.title.trim()} onClick={() => void create(false)}>
              {isIdea ? <ArrowRight size={14} /> : <Plus size={15} />}
              {isIdea ? 'Make it a task' : 'Create task'}
            </button>
            {canStart && (
              <button type="button" disabled={busy || !draft.title.trim()} onClick={() => void create(true)}>
                <Play size={14} />
                {isIdea ? 'Make it a task and start session' : 'Create and start session'}
              </button>
            )}
          </>
        }
      />
    </section>
  );
}
