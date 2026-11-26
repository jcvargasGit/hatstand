import { useState } from 'react';
import type { Snapshot } from '../../../shared/api';
import type { Task } from '../../../shared/schemas';
import { clientChangeMessage, clientChangeOf } from '../../../shared/task-client';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';

type ChangeClientProps = {
  snapshot: Pick<Snapshot, 'companies' | 'sessions'>;
  task: Task;
  onChanged: () => Promise<void>;
};

/** The client of a task. Choosing another one asks first, and says whether the task moves or a copy is created. */
export function ChangeClient({ snapshot, task, onChanged }: ChangeClientProps) {
  const [chosenId, setChosenId] = useState<string | null>(null);
  const { error, busy, run } = useAction();
  const clients = snapshot.companies.filter((company) => !company.archivedAt || company.id === task.companyId);
  const chosen = clients.find((company) => company.id === chosenId && company.id !== task.companyId);

  if (clients.length < 2) return null;
  const change = clientChangeOf(task, snapshot.sessions);

  return (
    <div className="client-change">
      <label className="stacked-field">
        Client
        <select value={chosen?.id ?? task.companyId} disabled={busy} onChange={(event) => setChosenId(event.target.value)}>
          {clients.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
      </label>
      {chosen && (
        <p className="client-change-confirm" role="alert">
          <span>{clientChangeMessage(change, chosen)}</span>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.changeTaskClient(task.id, chosen.id);
                setChosenId(null);
                await onChanged();
              })
            }
          >
            {change === 'move' ? 'Move task' : 'Create a copy'}
          </button>
          <button className="quiet" disabled={busy} onClick={() => setChosenId(null)}>
            Cancel
          </button>
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
