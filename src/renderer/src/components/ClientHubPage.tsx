import type { Snapshot } from '../../../shared/api';
import type { Company } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { CLIENT_LINK_SUGGESTIONS } from '../lib/link-suggestions';
import { AreaList } from './AreaList';
import { LinksEditor } from './LinksEditor';

type ClientHubPageProps = {
  snapshot: Snapshot;
  company: Company;
  onChanged: () => Promise<void>;
  onOpenArea: (areaId: string) => void;
};

export function ClientHubPage({ snapshot, company, onChanged, onOpenArea }: ClientHubPageProps) {
  const { error, run } = useAction();
  return (
    <main className="page client-hub">
      {error && <p className="error">{error}</p>}
      <div className="client-hub-grid">
        <section className="overview-card" aria-label="Areas">
          <h3>Areas</h3>
          <AreaList snapshot={snapshot} company={company} onChanged={onChanged} onOpenArea={onOpenArea} />
        </section>
        <section className="overview-card" aria-label="Links of the client">
          <h3>Links of the client</h3>
          <p className="hint">Everything you open for this client, in one place: chat, tickets, code, and each environment or platform. Every task can use them.</p>
          <LinksEditor
            links={company.links}
            suggestions={CLIENT_LINK_SUGGESTIONS}
            onChange={(links) =>
              void run(async () => {
                await api.saveCompany({ ...company, links });
                await onChanged();
              })
            }
          />
        </section>
      </div>
    </main>
  );
}
