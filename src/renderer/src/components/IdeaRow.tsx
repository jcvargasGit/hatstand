import { ArrowDown, ArrowRight, ArrowUp, GripVertical, Trash2, X } from 'lucide-react';
import { useRef, useState, type MouseEvent } from 'react';
import type { Task } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { checklistProgress, firstLine, ideaTitleId } from '../lib/inbox';
import { PrioritySelect } from './PrioritySelect';

type IdeaRowProps = {
  task: Task;
  selected: boolean;
  onSelect: () => void;
  picked: boolean;
  onPick: (picked: boolean) => void;
  onChanged: () => Promise<void>;
  onMadeTask: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDragStart: () => void;
  onDropHere: () => void;
};

const keepRowClosed = (event: MouseEvent) => event.stopPropagation();

export function IdeaRow({ task, selected, onSelect, picked, onPick, onChanged, onMadeTask, onMoveUp, onMoveDown, onDragStart, onDropHere }: IdeaRowProps) {
  const [confirming, setConfirming] = useState(false);
  const [dragState, setDragState] = useState<'idle' | 'dragging' | 'over'>('idle');
  const row = useRef<HTMLTableRowElement>(null);
  const { error, busy, run } = useAction();
  const summary = firstLine(task.description);
  const progress = task.checklist.length > 0 ? checklistProgress(task) : null;

  return (
    <tr
      ref={row}
      className={`idea-row is-${dragState}${selected ? ' is-selected' : ''}`}
      onClick={onSelect}
      onDragOver={(event) => {
        event.preventDefault();
        if (dragState === 'idle') setDragState('over');
      }}
      onDragLeave={(event) => {
        if (dragState === 'over' && !event.currentTarget.contains(event.relatedTarget as Node | null)) setDragState('idle');
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragState('idle');
        onDropHere();
      }}
    >
      <td className="idea-col-pick" onClick={keepRowClosed}>
        <input type="checkbox" aria-label={`Select ${task.title}`} checked={picked} onChange={(event) => onPick(event.target.checked)} />
      </td>
      <td className="idea-col-order" onClick={keepRowClosed}>
        <div className="idea-order">
          <span
            className="idea-grip"
            draggable
            title="Drag to reorder"
            aria-hidden="true"
            onDragStart={(event) => {
              if (row.current) event.dataTransfer?.setDragImage(row.current, 12, 12);
              setDragState('dragging');
              onDragStart();
            }}
            onDragEnd={() => setDragState('idle')}
          >
            <GripVertical size={14} />
          </span>
          <button className="quiet" aria-label={`Move ${task.title} up`} title="Move up" disabled={!onMoveUp} onClick={onMoveUp}>
            <ArrowUp size={14} />
          </button>
          <button className="quiet" aria-label={`Move ${task.title} down`} title="Move down" disabled={!onMoveDown} onClick={onMoveDown}>
            <ArrowDown size={14} />
          </button>
        </div>
      </td>
      <td className="idea-col-title">
        <button id={ideaTitleId(task.id)} className="idea-toggle" aria-expanded={selected} title={task.title}>
          <span>{task.title}</span>
        </button>
        {summary && <p className="idea-summary">{summary}</p>}
        {progress && <p className="idea-summary idea-summary-checklist">{progress}</p>}
        {error && <p className="error">{error}</p>}
      </td>
      <td className="idea-col-details">{summary}</td>
      <td className="idea-col-checklist">{progress}</td>
      <td className="idea-col-priority" onClick={keepRowClosed}>
        <PrioritySelect
          value={task.priority}
          label={`Priority of ${task.title}`}
          onChange={(priority) =>
            void run(async () => {
              await api.updateTask(task.id, { priority });
              await onChanged();
            })
          }
        />
      </td>
      <td className="idea-col-actions" onClick={keepRowClosed}>
        <div className="idea-actions">
          {confirming ? (
            <>
              <button
                className="danger"
                aria-label="Delete"
                title="Delete"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api.deleteTask(task.id);
                    await onChanged();
                  })
                }
              >
                <Trash2 size={14} />
                <span className="idea-action-label">Delete</span>
              </button>
              <button className="quiet" aria-label="Cancel" title="Cancel" onClick={() => setConfirming(false)}>
                <X size={14} />
                <span className="idea-action-label">Cancel</span>
              </button>
            </>
          ) : (
            <>
              <button
                className="quiet"
                aria-label="Make it a task"
                title="Make it a task"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api.updateTask(task.id, { status: 'todo' });
                    await onChanged();
                    onMadeTask();
                  })
                }
              >
                <ArrowRight size={14} />
                <span className="idea-action-label">Make it a task</span>
              </button>
              <button className="quiet" aria-label={`Delete ${task.title}`} title="Delete" onClick={() => setConfirming(true)}>
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
