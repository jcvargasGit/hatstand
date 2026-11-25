import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Company, Session, Task } from '../../../shared/schemas';
import { parseTaskNotes } from '../../../shared/task-notes';
import { summaryBlockedReason } from '../../../shared/task-summary';
import { useAction } from '../hooks/useAction';
import { useOutsideChanges } from '../hooks/useOutsideChanges';
import { usePanelSections } from '../hooks/usePanelSections';
import { useTaskChanges } from '../hooks/useTaskChanges';
import { useTaskNote } from '../hooks/useTaskNote';
import { useTaskOutputs } from '../hooks/useTaskOutputs';
import { hasWork, repoWork } from '../lib/agent-work';
import { api } from '../lib/api';
import { AgentWork } from './AgentWork';
import { MarkdownComposer } from './MarkdownComposer';
import { MarkdownView } from './MarkdownView';
import { PanelSection } from './PanelSection';

const UPDATE_TIMEOUT_MS = 120_000;
/** How often the files are read again while the agent works, so the person never has to refresh. */
export const FILES_REFRESH_MS = 4000;

type TerminalInfoPanelProps = {
  task: Task;
  company: Company;
  session: Session;
  notes: string;
  onLeave: () => void;
};

/** Beside the terminal: what the agent has done so far, its TL;DR, and your own note. */
export function TerminalInfoPanel({ task, company, session, notes, onLeave }: TerminalInfoPanelProps) {
  const note = useTaskNote(task.id);
  const { error, busy, run } = useAction();
  const [notesWhenAsked, setNotesWhenAsked] = useState<string | null>(null);
  const sections = usePanelSections();
  const previousState = useRef(session.state);
  const updating = notesWhenAsked !== null;
  const changes = useTaskChanges(task.id, session.state, session.state === 'stopped' ? 0 : FILES_REFRESH_MS);
  const work = changes.reports.map(repoWork).filter(hasWork);
  const documents = useTaskOutputs(task.id);
  const outside = useOutsideChanges(task.id, session.state);

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

  const openPath = useCallback((path: string) => void run(() => api.openInEditor(company.id, path)), [run, company.id]);

  const blocked = summaryBlockedReason(session.state, session.draft);
  const { summary, lastDone, pending } = parseTaskNotes(notes);
  const hasSummary = Boolean(summary || lastDone || pending);


  return (
    <aside className="terminal-notes agent-work" aria-label="Agent work">
      <PanelSection
        title="TL;DR"
        className="terminal-summary"
        open={sections.isOpen('summary')}
        onToggle={() => sections.toggle('summary')}
        actions={
          <button
            className="quiet"
            disabled={busy || updating || blocked !== null}
            title={blocked ?? 'Ask the agent to update its summary. This adds a turn to the conversation.'}
            onClick={() =>
              void run(async () => {
                await api.refreshTaskSummary(task.id);
                setNotesWhenAsked(notes);
              })
            }
          >
            <RefreshCw size={13} />
            {busy || updating ? 'Updating…' : 'Update'}
          </button>
        }
      >
        {hasSummary ? (
          <div className="terminal-summary-body">
            {summary && <MarkdownView text={summary} onOpenPath={openPath} />}
            {lastDone && (
              <>
                <h4>Last done</h4>
                <MarkdownView text={lastDone} onOpenPath={openPath} />
              </>
            )}
            {pending && (
              <>
                <h4>Pending</h4>
                <MarkdownView text={pending} onOpenPath={openPath} />
              </>
            )}
          </div>
        ) : (
          <p className="hint">The agent has not written a summary yet.</p>
        )}
      </PanelSection>
      {error && <p className="error">{error}</p>}

      <AgentWork task={task} company={company} work={work} documents={documents} outside={outside.changes} hasNotes={notes.trim() !== ''} sections={sections} />
      {changes.error && <p className="error">{changes.error}</p>}

      <PanelSection title="Your note" className="terminal-note" open={sections.isOpen('note')} onToggle={() => sections.toggle('note')}>
        {note.initialNote !== null && (
          <MarkdownComposer className="terminal-note-editor" initialValue={note.initialNote} label="Task note" placeholderText="Where you stopped reading, in Markdown" onChange={note.change} onBlur={note.flush} onLeave={onLeave} />
        )}
      </PanelSection>
      {note.error && <p className="error">{note.error}</p>}
    </aside>
  );
}
