import { type FormEvent, useState } from 'react';
import type { Task } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';

type TaskIssueLinkProps = {
  task: Task;
  onChanged: () => Promise<void>;
};

export function TaskIssueLink({ task, onChanged }: TaskIssueLinkProps) {
  const [reference, setReference] = useState('');
  const { error, busy, run } = useAction();

  const link = (event: FormEvent) => {
    event.preventDefault();
    if (!reference.trim()) return;
    void run(async () => {
      await api.linkTaskIssue(task.id, reference);
      setReference('');
      await onChanged();
    });
  };

  const unlink = () =>
    void run(async () => {
      await api.unlinkTaskIssue(task.id);
      await onChanged();
    });

  return (
    <div className="task-issue-link" aria-label="Issue">
      <strong>Issue</strong>
      {task.source ? (
        <p>
          {task.source.url ? (
            <a href={task.source.url} target="_blank" rel="noreferrer">
              {task.source.key}
            </a>
          ) : (
            <span>{task.source.key}</span>
          )}
          <button type="button" className="quiet" disabled={busy} onClick={unlink}>
            Unlink
          </button>
        </p>
      ) : (
        <form className="inline-form" onSubmit={link}>
          <input aria-label="Issue link or key" placeholder="Issue link, or owner/repo#12" value={reference} onChange={(event) => setReference(event.target.value)} />
          <button type="submit" disabled={busy || !reference.trim()}>
            Link
          </button>
        </form>
      )}
      <p className="hint">Hatstand keeps #{task.number ?? '?'} as this task&apos;s number. Linking only records the GitHub, GitLab or Jira issue next to it.</p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
