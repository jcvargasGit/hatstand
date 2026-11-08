import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Session } from '../../../shared/schemas';
import { parseTaskNotes } from '../../../shared/task-notes';
import { summaryBlockedReason } from '../../../shared/task-summary';
import { useAction } from '../hooks/useAction';
import { useTaskNote } from '../hooks/useTaskNote';
import { api } from '../lib/api';
import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownView } from './MarkdownView';

const UPDATE_TIMEOUT_MS = 120_000;

type TerminalNotesPanelProps = {
  taskId: string;
  session: Session;
  notes: string;
  onLeave: () => void;
};

export function TerminalNotesPanel({ taskId, session, notes, onLeave }: TerminalNotesPanelProps) {
  const note = useTaskNote(taskId);
  const { error, busy, run } = useAction();
  const [notesWhenAsked, setNotesWhenAsked] = useState<string | null>(null);
  const previousState = useRef(session.state);
  const updating = notesWhenAsked !== null;

  useEffect(() => {
    const finishedTurn = previousState.current === 'working' && session.state !== 'working';
    previousState.current = session.state;
    if (notesWhenAsked === null) return;
    if (finishedTurn || session.state === 'stopped' || notes !== notesWhenAsked) setNotesWhenAsked(null);
  }, [notes, notesWhenAsked, session.state]);

  useEffect(() => {
    if (!updating) return;
    const timer = setTimeout(() => setNotesWhenAsked(null), UPDATE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [updating]);

  const blocked = summaryBlockedReason(session.state, session.draft);
  const { summary, lastDone, pending } = parseTaskNotes(notes);
  const hasSummary = Boolean(summary || lastDone || pending);

  return (
    <aside className="terminal-notes" aria-label="Task note panel">
      <section className="terminal-summary" aria-label="TL;DR">
        <div className="terminal-notes-head">
          <h3>TL;DR</h3>
          <button
            className="quiet"
            disabled={busy || updating || blocked !== null}
            title={blocked ?? 'Ask the agent to update its summary. This adds a turn to the conversation.'}
            onClick={() =>
              void run(async () => {
                await api.refreshTaskSummary(taskId);
                setNotesWhenAsked(notes);
              })
            }
          >
            <RefreshCw size={13} />
            {busy || updating ? 'Updating…' : 'Update'}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {hasSummary ? (
          <div className="terminal-summary-body">
            {summary && <MarkdownView text={summary} />}
            {lastDone && (
              <>
                <h4>Last done</h4>
                <MarkdownView text={lastDone} />
              </>
            )}
            {pending && (
              <>
                <h4>Pending</h4>
                <MarkdownView text={pending} />
              </>
            )}
          </div>
        ) : (
          <p className="hint">The agent has not written a summary yet.</p>
        )}
      </section>
      <section className="terminal-note" aria-label="Your note">
        <h3>Your note</h3>
        {note.error && <p className="error">{note.error}</p>}
        {note.initialNote !== null && (
          <MarkdownEditor initialValue={note.initialNote} label="Task note" placeholderText="Where you stopped reading, in Markdown" onChange={note.change} onBlur={note.flush} onLeave={onLeave} />
        )}
      </section>
    </aside>
  );
}
