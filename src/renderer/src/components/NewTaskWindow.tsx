import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { NewTaskDraft } from '../../../shared/new-task-draft';
import { useSnapshot } from '../hooks/useSnapshot';
import { api } from '../lib/api';
import { fitDraft } from '../lib/new-task-draft';
import { inkOn, NEUTRAL_TINT } from '../lib/today';
import { NewTaskPage } from './NewTaskPage';

type NewTaskWindowProps = { draftId: string };

/** The New task form in a window of its own. The main process keeps the draft, so reloading this window loses nothing. */
export function NewTaskWindow({ draftId }: NewTaskWindowProps) {
  const { snapshot, refresh } = useSnapshot();
  const [draft, setDraft] = useState<NewTaskDraft | null | undefined>(undefined);
  const [companyId, setCompanyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.readNewTaskDraft(draftId).then((saved) => {
      if (active) setDraft(saved);
    });
    return () => {
      active = false;
    };
  }, [draftId]);

  const keep = useCallback(
    (next: NewTaskDraft) => {
      setCompanyId(next.companyId);
      void api.saveNewTaskDraft(draftId, next);
    },
    [draftId],
  );

  if (!snapshot || draft === undefined) return <main className="loading">Opening the task</main>;
  if (draft === null) return <main className="loading">This task was already created or closed. You can close this window.</main>;

  const active = { ...snapshot, companies: snapshot.companies.filter((company) => !company.archivedAt) };
  const tint = active.companies.find((company) => company.id === (companyId ?? draft.companyId))?.color ?? NEUTRAL_TINT;

  return (
    <div className="shell new-task-window" style={{ '--client': tint, '--ink-on-client': inkOn(tint) } as CSSProperties}>
      <div className="client-view">
        <NewTaskPage snapshot={active} initialDraft={fitDraft(draft, active)} onDraftChange={keep} onChanged={refresh} onCreated={(taskId) => api.finishNewTaskWindow(draftId, taskId)} />
      </div>
    </div>
  );
}
