import { ArrowRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Task } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { MarkdownField } from './MarkdownField';
import { PrioritySelect } from './PrioritySelect';
import { TaskChecklist } from './TaskChecklist';

type IdeaDetailsProps = {
  task: Task;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onMadeTask: () => void;
};

export function IdeaDetails({ task, onClose, onChanged, onMadeTask }: IdeaDetailsProps) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const { error, busy, run } = useAction();
  const saving = useAction();

  const save = (latestDescription = description) =>
    saving.run(async () => {
      if (title.trim() && (title !== task.title || latestDescription !== task.description)) await api.updateTask(task.id, { title: title.trim(), customTitle: true, description: latestDescription });
      await onChanged();
    });

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target as HTMLElement;
      if (target.matches('input, textarea, select') && !target.closest('.idea-details')) return;
      void save();
      onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  });

  return (
    <aside className="idea-details" aria-label="Inbox item details">
      <div className="idea-details-head">
        <h3>Inbox item</h3>
        <button autoFocus className="quiet" aria-label="Close details" title="Close" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <label>
        Title
        <input value={title} onChange={(event) => setTitle(event.target.value)} onBlur={() => void save()} />
      </label>
      <div className="idea-details-field">
        <span>Details</span>
        <MarkdownField label="Details" rows={8} value={description} placeholder="What you know so far." onChange={setDescription} onCommit={(text) => void save(text)} />
      </div>
      <label>
        Priority
        <PrioritySelect
          value={task.priority}
          label="Priority"
          onChange={(priority) =>
            void run(async () => {
              await api.updateTask(task.id, { priority });
              await onChanged();
            })
          }
        />
      </label>
      <div className="idea-details-checklist">
        <h4>Checklist</h4>
        <TaskChecklist task={task} onChanged={onChanged} />
      </div>
      <button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await api.updateTask(task.id, { title: title.trim() || task.title, description, status: 'todo' });
            await onChanged();
            onMadeTask();
          })
        }
      >
        <ArrowRight size={14} />
        Make it a task
      </button>
      {(error || saving.error) && <p className="error">{error || saving.error}</p>}
    </aside>
  );
}
