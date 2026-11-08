import type { Company } from '../../../shared/schemas';
import { ClientAvatar } from './ClientAvatar';

export type ClientTab = 'tasks' | 'closed' | 'inbox' | 'hub' | 'documents' | 'setup';

type ClientTabsProps = {
  company: Company;
  active: ClientTab;
  inboxCount: number;
  onSelect: (tab: ClientTab) => void;
};

const TABS: { id: ClientTab; label: string }[] = [
  { id: 'tasks', label: 'Tasks' },
  { id: 'closed', label: 'Closed tasks' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'hub', label: 'Areas' },
  { id: 'documents', label: 'Documents' },
  { id: 'setup', label: 'Client settings' },
];

export function ClientTabs({ company, active, inboxCount, onSelect }: ClientTabsProps) {
  return (
    <header className="client-tabs">
      <h1 className="title-with-avatar">
        <ClientAvatar company={company} />
        {company.name}
      </h1>
      <div className="task-tabs" role="tablist" aria-label={`${company.name} sections`}>
        {TABS.map((tab) => (
          <button key={tab.id} role="tab" className="task-tab" aria-selected={active === tab.id} onClick={() => onSelect(tab.id)}>
            {tab.label}
            {tab.id === 'inbox' && inboxCount > 0 && <span className="board-count">{inboxCount}</span>}
          </button>
        ))}
      </div>
    </header>
  );
}
