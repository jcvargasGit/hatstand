import { Bot, Check, ChevronDown, ChevronUp, Square } from 'lucide-react';
import { useState } from 'react';
import type { Session } from '../../../shared/schemas';
import { useSubagents } from '../hooks/useSubagents';
import { plural } from '../lib/text';

const STATE_TEXT = { running: 'Running', finished: 'Finished', stopped: 'Stopped with the session' };
const STATE_ICON = { running: Bot, finished: Check, stopped: Square };

export function SubagentActivity({ session }: { session: Session }) {
  const runs = useSubagents(session);
  const [open, setOpen] = useState(false);
  if (runs.length === 0) return null;

  const running = runs.filter((run) => run.state === 'running').length;
  const label = running > 0 ? `${plural(runs.length, 'subagent', 'subagents')}, ${running} running` : plural(runs.length, 'subagent', 'subagents');

  return (
    <section className="subagents" aria-label="Subagents">
      <button className="panel-details-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        {label}
      </button>
      {open && (
        <ul className="subagent-list">
          {runs.map((run) => {
            const Icon = STATE_ICON[run.state];
            return (
              <li key={run.id} className={`subagent is-${run.state}`}>
                <Icon size={14} aria-label={STATE_TEXT[run.state]} />
                <div>
                  <strong>{run.type}</strong>
                  {run.description && <span>{run.description}</span>}
                  {run.summary && (
                    <details>
                      <summary>Result</summary>
                      <p>{run.summary}</p>
                    </details>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
