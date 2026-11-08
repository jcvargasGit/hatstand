import { hasTaskSummary, parseTaskNotes } from '../../../shared/task-notes';
import { MarkdownView } from './MarkdownView';

type TaskNotesProps = {
  notes: string;
  empty: string;
};

export function TaskNotes({ notes, empty }: TaskNotesProps) {
  if (!notes.trim()) return <p className="hint">{empty}</p>;
  const parsed = parseTaskNotes(notes);
  if (!hasTaskSummary(parsed)) return <MarkdownView text={notes} />;
  return (
    <div className="task-stand">
      {parsed.summary && (
        <div className="task-stand-summary" aria-label="TL;DR">
          <MarkdownView text={parsed.summary} />
        </div>
      )}
      <dl className="task-stand-facts">
        {parsed.lastDone && (
          <div>
            <dt>Last done</dt>
            <dd>
              <MarkdownView text={parsed.lastDone} />
            </dd>
          </div>
        )}
        {parsed.pending && (
          <div>
            <dt>Pending</dt>
            <dd>
              <MarkdownView text={parsed.pending} />
            </dd>
          </div>
        )}
      </dl>
      {parsed.details && (
        <details className="task-stand-details">
          <summary>Full notes</summary>
          <MarkdownView text={parsed.details} />
        </details>
      )}
    </div>
  );
}
