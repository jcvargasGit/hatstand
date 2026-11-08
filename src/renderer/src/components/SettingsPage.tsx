import { Archive, ArchiveRestore, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ClientRemovalReport, Snapshot } from '../../../shared/api';
import type { Company } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { useClientReadiness } from '../hooks/useClientReadiness';
import { api } from '../lib/api';
import { plural } from '../lib/text';
import { AccountsSection } from './AccountsSection';
import { ClientAvatar } from './ClientAvatar';
import { NewTasksSection } from './NewTasksSection';
import { RemoveClientForm } from './RemoveClientForm';
import { StayAwakeSection } from './StayAwakeSection';

type SettingsPageProps = {
  snapshot: Snapshot;
  onChanged: () => Promise<void>;
  onOpenClient: (companyId: string) => void;
  onAddClient: () => void;
};

function ClientSettingsRow({ snapshot, company, onOpen, onArchive }: { snapshot: Snapshot; company: Company; onOpen: () => void; onArchive: () => void }) {
  const { percent } = useClientReadiness(snapshot, company);
  return (
    <li className="settings-client-row">
      <button className="settings-client" onClick={onOpen}>
        <ClientAvatar company={company} size="small" />
        <span className="nav-name">{company.name}</span>
        <small>{percent === 100 ? 'Fully set up' : `${percent}% set up`}</small>
      </button>
      <button className="quiet" aria-label={`Archive ${company.name}`} title="Archive this client" onClick={onArchive}>
        <Archive size={15} />
      </button>
    </li>
  );
}

function removalMessage(name: string, report: ClientRemovalReport): string {
  const kept = report.keptFilesIn ? `Its files are in ${report.keptFilesIn}.` : 'Its files were deleted.';
  const hooks = report.protectionKept.length > 0 ? ` The commit check stays in ${plural(report.protectionKept.length, 'repository', 'repositories')} that another client also uses.` : '';
  return `Removed ${name}. ${kept}${hooks}`;
}

export function SettingsPage({ snapshot, onChanged, onOpenClient, onAddClient }: SettingsPageProps) {
  const [removing, setRemoving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { error, busy, run } = useAction();
  const active = snapshot.companies.filter((company) => !company.archivedAt);
  const archived = snapshot.companies.filter((company) => company.archivedAt);

  const change = (action: () => Promise<void>) =>
    run(async () => {
      setMessage(null);
      await action();
      await onChanged();
    });

  return (
    <main className="page page-narrow">
      <h1>Settings</h1>
      <div className="settings-columns">
      <StayAwakeSection />
      <NewTasksSection enabled={snapshot.guideNewTasks} onChanged={onChanged} />
      <section className="settings-group" aria-labelledby="settings-clients">
        <h2 id="settings-clients">Clients</h2>
        <ul className="settings-clients">
          {active.map((company) => (
            <ClientSettingsRow
              key={company.id}
              snapshot={snapshot}
              company={company}
              onOpen={() => onOpenClient(company.id)}
              onArchive={() => void change(() => api.archiveClient(company.id))}
            />
          ))}
        </ul>
        <button className="quiet" onClick={onAddClient}>
          <Plus size={15} />
          Add client
        </button>
        {error && <p className="error">{error}</p>}
        {message && <p className="hint" role="status">{message}</p>}
      </section>
      {archived.length > 0 && (
        <section className="settings-group" aria-labelledby="settings-archived">
          <h2 id="settings-archived">Archived clients</h2>
          <p className="hint">Hidden from your tasks, with everything kept. Restore one to continue, or remove it from Hatstand.</p>
          <ul className="settings-clients">
            {archived.map((company) => (
              <li key={company.id}>
                <div className="settings-client-row">
                  <span className="settings-client is-archived">
                    <ClientAvatar company={company} size="small" />
                    <span className="nav-name">{company.name}</span>
                  </span>
                  <button className="quiet" disabled={busy} onClick={() => void change(() => api.restoreClient(company.id))}>
                    <ArchiveRestore size={15} />
                    Restore
                  </button>
                  <button className="quiet" onClick={() => setRemoving(removing === company.id ? null : company.id)}>
                    <Trash2 size={15} />
                    Remove
                  </button>
                </div>
                {removing === company.id && (
                  <RemoveClientForm
                    company={company}
                    onCancel={() => setRemoving(null)}
                    onRemoved={async (report) => {
                      setRemoving(null);
                      setMessage(removalMessage(company.name, report));
                      await onChanged();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <AccountsSection snapshot={snapshot} onChanged={onChanged} />
      </div>
    </main>
  );
}
