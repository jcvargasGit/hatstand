import { Download, ListTodo } from 'lucide-react';
import { useState } from 'react';
import type { TrackerSyncReport } from '../../../shared/api';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { plural } from '../lib/text';

type AssignedWorkProps = {
  companyId: string;
  onChanged: () => Promise<void>;
};

export function AssignedWork({ companyId, onChanged }: AssignedWorkProps) {
  const [sync, setSync] = useState<TrackerSyncReport | null>(null);
  const { error, busy, run } = useAction();

  return (
    <section className="settings-section" id="section-work">
      <h2>
        <ListTodo size={18} />
        Assigned work
      </h2>
      <p className="hint">Brings in the open issues assigned to you from Jira, GitHub and GitLab, using this client&rsquo;s keys.</p>
      <button
        className="quiet"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            setSync(await api.syncTrackers(companyId));
            await onChanged();
          })
        }
      >
        <Download size={15} />
        {busy ? 'Importing' : 'Import assigned work'}
      </button>
      {sync && sync.checked.length === 0 && <p className="hint">No tracker keys found. Add them under Keys first.</p>}
      {sync && sync.checked.length > 0 && (
        <p className="hint">
          Checked {sync.checked.join(', ')}. Added {plural(sync.added, 'task', 'tasks')} and updated {sync.updated}.
        </p>
      )}
      {sync?.errors.map((item) => (
        <p className="error" key={item}>
          {item}
        </p>
      ))}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
