import { Plus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { ChecklistItem, Task } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';

type TaskChecklistProps = {
  task: Task;
  onChanged: () => Promise<void>;
};

export function TaskChecklist({ task, onChanged }: TaskChecklistProps) {
  const [text, setText] = useState('');
  const { error, busy, run } = useAction();
  const save = (checklist: ChecklistItem[]) =>
    run(async () => {
      await api.updateTask(task.id, { checklist });
      await onChanged();
    });
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    void save([...task.checklist, { id: crypto.randomUUID(), text: text.trim(), done: false }]);
    setText('');
  };

  return (
    <div className="task-checklist">
      {task.checklist.length > 0 && (
        <ul>
          {task.checklist.map((item) => (
            <li key={item.id}>
              <label className={item.done ? 'is-done' : undefined}>
                <input type="checkbox" checked={item.done} onChange={() => void save(task.checklist.map((other) => (other.id === item.id ? { ...other, done: !other.done } : other)))} />
                <span>{item.text}</span>
              </label>
              <button type="button" className="quiet" aria-label={`Remove ${item.text}`} title="Remove" disabled={busy} onClick={() => void save(task.checklist.filter((other) => other.id !== item.id))}>
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="task-checklist-add" onSubmit={add}>
        <input aria-label={`Add to the checklist of ${task.title}`} placeholder="Add a checklist item" value={text} onChange={(event) => setText(event.target.value)} />
        <button className="quiet" disabled={busy || !text.trim()}>
          <Plus size={14} />
          Add
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
