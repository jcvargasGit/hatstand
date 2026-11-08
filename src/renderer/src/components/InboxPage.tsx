import { ArrowDownWideNarrow, ArrowRight, Inbox, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import type { Snapshot } from '../../../shared/api';
import { hasWorkspace } from '../../../shared/readiness';
import type { Company, Task } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { useSelection } from '../hooks/useSelection';
import { api, errorMessage } from '../lib/api';
import { moveClient as moveItem } from '../lib/client-order';
import { byPriority, ideaTitleId, inboxOrder } from '../lib/inbox';
import { plural } from '../lib/text';
import { isIdea } from '../lib/today';
import { AssistantRunConfirm } from './AssistantRunConfirm';
import { ClientAvatar } from './ClientAvatar';
import { IdeaDetails } from './IdeaDetails';
import { IdeaRow } from './IdeaRow';
import { InboxCapture } from './InboxCapture';

type InboxPageProps = {
  snapshot: Snapshot;
  companyId: string | null;
  onOpenTask: (taskId: string, companyId: string) => void;
  onChanged: () => Promise<void>;
};

type NotStarted = { taskId: string; companyId: string; message: string };

export function InboxPage({ snapshot, companyId, onOpenTask, onChanged }: InboxPageProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dragging = useRef<string | null>(null);
  const { isPicked, pick } = useSelection();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notStarted, setNotStarted] = useState<NotStarted | null>(null);
  const { error, busy, run } = useAction();
  const visible = companyId ? snapshot.companies.filter((company) => company.id === companyId) : snapshot.companies;
  const pending = snapshot.tasks.filter((task) => isIdea(task) && !task.archivedAt && visible.some((company) => company.id === task.companyId));
  const selected = pending.find((task) => task.id === selectedId);

  const closeDetails = () => {
    setSelectedId(null);
    if (selectedId) requestAnimationFrame(() => document.getElementById(ideaTitleId(selectedId))?.focus());
  };

  const reorder = (items: Task[]) =>
    run(async () => {
      await api.reorderTasks(items.map((item) => item.id));
      await onChanged();
    });

  const moveWithin = (items: Task[], moving: string | null, onto: string | undefined) => {
    const ids = items.map((item) => item.id);
    if (!moving || !onto || !ids.includes(moving)) return;
    void run(async () => {
      await api.reorderTasks(moveItem(ids, moving, onto));
      await onChanged();
    });
  };

  const runWithAssistant = (company: Company, chosen: Task[]) =>
    run(async () => {
      setNotStarted(null);
      const task = await api.planBacklog(company.id, chosen.map((item) => item.id));
      pick(chosen.map((item) => item.id), false);
      setConfirming(null);
      if (hasWorkspace(company)) {
        try {
          await api.startSession(task.id);
        } catch (caught) {
          await onChanged();
          setNotStarted({ taskId: task.id, companyId: company.id, message: errorMessage(caught) });
          return;
        }
      }
      await onChanged();
      onOpenTask(task.id, company.id);
    });

  return (
    <main className={selected ? 'page inbox-page has-details' : 'page inbox-page'}>
      <div className="inbox-list">
      {companyId ? <h2>Inbox</h2> : <h1>Inbox</h1>}
      <p className="hint">Keep work you have not defined yet. It stays out of your tasks until you make it one.</p>

      <InboxCapture companies={snapshot.companies} companyId={companyId} onChanged={onChanged} />
      {error && <p className="error">{error}</p>}

      {pending.length === 0 ? (
        <p className="empty">
          <Inbox size={16} /> Nothing waiting for review.
        </p>
      ) : (
        visible.map((company) => {
          const items = inboxOrder(pending.filter((task) => task.companyId === company.id));
          const chosen = items.filter((item) => isPicked(item.id));
          const allChosen = chosen.length === items.length;
          return (
            items.length > 0 && (
              <section key={company.id} className="inbox-group" aria-label={`${company.name} inbox`}>
                <h2 className="title-with-avatar">
                  <ClientAvatar company={company} size="small" />
                  {company.name}
                  <span className="hint">{plural(items.length, 'task', 'tasks')} to review</span>
                  <span className="inbox-group-actions">
                    {chosen.length > 0 && <span className="hint">{chosen.length} selected</span>}
                    {items.some((item) => item.priority !== 'none') && (
                      <button className="quiet inbox-sort" disabled={busy} onClick={() => void reorder(byPriority(items))}>
                        <ArrowDownWideNarrow size={14} />
                        Sort by priority
                      </button>
                    )}
                    <button
                      className={chosen.length > 0 ? 'inbox-assistant' : 'quiet inbox-assistant'}
                      disabled={busy || chosen.length === 0}
                      title={chosen.length === 0 ? 'Select the tasks the assistant should plan.' : 'The assistant proposes a plan in a new planning task. It does not run any task.'}
                      onClick={() => setConfirming(company.id)}
                    >
                      <Sparkles size={14} />
                      Run with assistant
                    </button>
                  </span>
                </h2>
                {confirming === company.id && chosen.length > 0 && (
                  <AssistantRunConfirm
                    company={company}
                    count={chosen.length}
                    busy={busy}
                    onConfirm={() => void runWithAssistant(company, chosen)}
                    onCancel={() => setConfirming(null)}
                  />
                )}
                {notStarted?.companyId === company.id && (
                  <p className="error inbox-not-started" role="alert">
                    <span>Hatstand created the planning task, but its session did not start: {notStarted.message}</span>
                    <button className="quiet" onClick={() => onOpenTask(notStarted.taskId, notStarted.companyId)}>
                      <ArrowRight size={14} />
                      Open the planning task
                    </button>
                  </p>
                )}
                <table className="inbox-table">
                  <thead>
                    <tr>
                      <th className="idea-col-pick">
                        <input
                          type="checkbox"
                          aria-label={`Select every task of ${company.name}`}
                          checked={allChosen}
                          ref={(box) => {
                            if (box) box.indeterminate = chosen.length > 0 && !allChosen;
                          }}
                          onChange={() => pick(items.map((item) => item.id), !allChosen)}
                        />
                      </th>
                      <th className="idea-col-order">Order</th>
                      <th className="idea-col-title">Task</th>
                      <th className="idea-col-details">Details</th>
                      <th className="idea-col-checklist">Checklist</th>
                      <th className="idea-col-priority">Priority</th>
                      <th className="idea-col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((task, index) => {
                      const before = items[index - 1];
                      const after = items[index + 1];
                      return (
                        <IdeaRow
                          key={task.id}
                          task={task}
                          selected={task.id === selectedId}
                          onSelect={() => (task.id === selectedId ? closeDetails() : setSelectedId(task.id))}
                          picked={isPicked(task.id)}
                          onPick={(on) => pick([task.id], on)}
                          onChanged={onChanged}
                          onMadeTask={() => onOpenTask(task.id, company.id)}
                          onMoveUp={before ? () => moveWithin(items, task.id, before.id) : undefined}
                          onMoveDown={after ? () => moveWithin(items, task.id, after.id) : undefined}
                          onDragStart={() => {
                            dragging.current = task.id;
                          }}
                          onDropHere={() => {
                            moveWithin(items, dragging.current, task.id);
                            dragging.current = null;
                          }}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </section>
            )
          );
        })
      )}
      </div>
      {selected && <IdeaDetails key={selected.id} task={selected} onClose={closeDetails} onChanged={onChanged} onMadeTask={() => onOpenTask(selected.id, selected.companyId)} />}
    </main>
  );
}
