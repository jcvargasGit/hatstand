import { Bot } from 'lucide-react';
import { AGENT_INFO } from '../../../shared/agents';
import type { Snapshot } from '../../../shared/api';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { AccountForm } from './AccountForm';

type AccountsSectionProps = {
  snapshot: Snapshot;
  onChanged: () => Promise<void>;
};

export function AccountsSection({ snapshot, onChanged }: AccountsSectionProps) {
  const { error, run } = useAction();
  const { accounts, defaultAccountId } = snapshot.accounts;
  const sharedCount = accounts.filter((account) => !account.companyId).length;
  const clientName = (companyId: string) => snapshot.companies.find((company) => company.id === companyId)?.name ?? companyId;

  const change = (action: () => Promise<void>) =>
    void run(async () => {
      await action();
      await onChanged();
    });

  return (
    <section className="settings-group" aria-labelledby="settings-agents">
      <header className="today-head">
        <h2 id="settings-agents">Agents</h2>
      </header>
      <p className="hint">An account can serve every client, or only one. Pick which to use per client or per task.</p>
      {error && <p className="error">{error}</p>}
      <ul className="account-list">
        {accounts.map((account) => (
          <li key={account.id}>
            <Bot className="account-icon" size={22} />
            <div>
              <strong>{account.name}</strong>
              <span className="hint">
                {AGENT_INFO[account.type].name}, {account.label}
                {account.model ? `, ${account.model}` : ''}
                {account.configDir ? `, ${account.configDir}` : ', signed in on this computer'}
                {account.companyId ? `, only for ${clientName(account.companyId)}` : ''}
              </span>
            </div>
            {account.id === defaultAccountId && <span className="hint">Your default</span>}
            {account.id !== defaultAccountId && !account.companyId && (
              <button className="quiet" onClick={() => change(() => api.setDefaultAccount(account.id))}>
                Make default
              </button>
            )}
            <button className="quiet" disabled={!account.companyId && sharedCount === 1} onClick={() => change(() => api.removeAccount(account.id))}>
              Remove
            </button>
          </li>
        ))}
      </ul>

      <AccountForm title="Add an account" clients={snapshot.companies} onAdded={onChanged} />
    </section>
  );
}
