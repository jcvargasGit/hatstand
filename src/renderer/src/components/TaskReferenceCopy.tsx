import { Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Task } from '../../../shared/schemas';
import { formatTaskReference } from '../../../shared/task-reference';
import { useAction } from '../hooks/useAction';

const COPIED_MS = 1500;

export function TaskReferenceCopy({ task }: { task: Task }) {
  const [copied, setCopied] = useState<string | null>(null);
  const { error, run } = useAction();
  const reference = formatTaskReference(task);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = (text: string) =>
    void run(async () => {
      await navigator.clipboard.writeText(text);
      setCopied(text);
    });

  return (
    <span className="task-reference">
      {reference && (
        <button type="button" className="quiet task-reference-copy" aria-label={`Copy reference ${reference}`} title="Copy this reference to name the task from any client" onClick={() => copy(reference)}>
          {reference}
          <Copy size={12} />
        </button>
      )}
      <button type="button" className="quiet task-reference-copy" aria-label="Copy UUID" title={`Copy the UUID ${task.id}`} onClick={() => copy(task.id)}>
        UUID
        <Copy size={12} />
      </button>
      <span role="status" className="task-reference-status">
        {copied ? `Copied ${copied}` : ''}
      </span>
      {error && <span className="error">{error}</span>}
    </span>
  );
}
