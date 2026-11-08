import { BookOpen, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { TaskOutput } from '../../../shared/api';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { MarkdownView } from './MarkdownView';

type TaskOutputRowProps = {
  taskId: string;
  output: TaskOutput;
  editorName: string | null;
};

export function TaskOutputRow({ taskId, output, editorName }: TaskOutputRowProps) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const { error, busy, run } = useAction();

  useEffect(() => {
    if (open) void run(async () => setContent(await api.readTaskOutput(taskId, output.name)));
  }, [open, taskId, output.name, output.updatedAt, run]);

  return (
    <li className="task-output">
      <div className="task-output-row">
        <span className="task-output-name">
          <strong>{output.name}</strong>
          <span className="hint">Updated {new Date(output.updatedAt).toLocaleString()}</span>
        </span>
        <button className="quiet" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Read'} ${output.name}`} onClick={() => setOpen(!open)}>
          <BookOpen size={14} />
          {open ? 'Hide' : 'Read'}
        </button>
        <button className="quiet" disabled={busy} aria-label={`Open ${output.name} in ${editorName ?? 'your default app'}`} onClick={() => void run(async () => void (await api.openTaskOutputInEditor(taskId, output.name)))}>
          <ExternalLink size={14} />
          {editorName ? `Open in ${editorName}` : 'Open file'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {open && content !== null && (
        <div className="task-output-body">
          <MarkdownView text={content} />
        </div>
      )}
    </li>
  );
}
