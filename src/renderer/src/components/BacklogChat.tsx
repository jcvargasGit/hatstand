import { MessagesSquare, RotateCcw, Send, Square } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import type { RelatedTask } from '../../../shared/backlog-chat';
import type { Company } from '../../../shared/schemas';
import { useBacklogChat } from '../hooks/useBacklogChat';
import { BacklogChatMessage } from './BacklogChatMessage';

type BacklogChatProps = {
  companies: Company[];
  companyId: string | null;
  onOpenTask: (taskId: string, companyId: string) => void;
};

/** Starts closed, so the backlog stays the first thing on the page. Closing it keeps the conversation. */
export function BacklogChat({ companies, companyId, onOpenTask }: BacklogChatProps) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(companyId ?? companies[0]?.id ?? '');
  const [text, setText] = useState('');
  const { exchanges, pending, failed, ask, stop, clear } = useBacklogChat(target);
  const question = text.trim();
  const openTask = (task: RelatedTask) => onOpenTask(task.taskId, target);

  const send = () => {
    if (!question || !target || pending) return;
    ask(question, exchanges);
    setText('');
  };

  const stopAsking = () => {
    setText(pending ?? '');
    stop();
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };

  return (
    <section className={open ? 'backlog-chat is-open' : 'backlog-chat'} aria-label="Backlog chat">
      <button type="button" className="quiet backlog-chat-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <MessagesSquare size={14} />
        Already done or planned?
      </button>
      {open && (
        <>
          <p className="hint">Ask before you add a task. The answer comes only from the tasks of the client: backlog, to do, in progress and done.</p>
          {!companyId && (
            <label>
              Client to ask about
              <select value={target} onChange={(event) => setTarget(event.target.value)}>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(exchanges.length > 0 || pending) && (
            <ol className="backlog-chat-turns" aria-live="polite">
              {exchanges.map((exchange, index) => (
                <BacklogChatMessage key={index} question={exchange.question} answer={exchange.answer} onOpenTask={openTask} />
              ))}
              {pending && <BacklogChatMessage question={pending} onOpenTask={openTask} />}
            </ol>
          )}
          {failed && (
            <p className="error backlog-chat-failed" role="alert">
              <span>
                No answer for “{failed.question}”: {failed.error}
              </span>
              <button type="button" className="quiet" onClick={() => ask(failed.question, exchanges)}>
                <RotateCcw size={14} />
                Try again
              </button>
            </p>
          )}
          <form
            className="backlog-chat-form"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <label>
              {exchanges.length > 0 ? 'Ask a follow-up' : 'Describe the task you are thinking of'}
              <textarea autoFocus rows={2} value={text} placeholder="Export the invoices as CSV" onChange={(event) => setText(event.target.value)} onKeyDown={onKey} />
            </label>
            <div className="backlog-chat-actions">
              {pending ? (
                <button type="button" className="quiet" onClick={stopAsking}>
                  <Square size={14} />
                  Stop
                </button>
              ) : (
                <button disabled={!question || !target} title="Enter sends. Shift+Enter adds a line.">
                  <Send size={14} />
                  Ask
                </button>
              )}
              {exchanges.length > 0 && !pending && (
                <button type="button" className="quiet" onClick={clear}>
                  New conversation
                </button>
              )}
            </div>
          </form>
        </>
      )}
    </section>
  );
}
