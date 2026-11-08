import { Pencil } from 'lucide-react';
import { useRef, useState } from 'react';

type TaskTitleProps = {
  title: string;
  disabled: boolean;
  onRename: (title: string) => void;
};

export function TaskTitle({ title, disabled, onRename }: TaskTitleProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);

  const finish = () => {
    const next = draft?.trim();
    if (!cancelled.current && next && next !== title) onRename(next);
    cancelled.current = false;
    setDraft(null);
  };

  if (draft === null) {
    return (
      <div className="task-title-row">
        <h2 title={title}>{title}</h2>
        <button className="task-rename" aria-label="Rename task" title="Rename task" disabled={disabled} onClick={() => setDraft(title)}>
          <Pencil size={14} />
        </button>
      </div>
    );
  }

  return (
    <input
      className="task-title-input"
      aria-label="Task name"
      autoFocus
      value={draft}
      onFocus={(event) => event.target.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          cancelled.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}
