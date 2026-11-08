import { CircleCheck, LogIn, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { accountsForClient } from '../../../shared/accounts';
import { AGENT_INFO } from '../../../shared/agents';
import type { AccountsFile, Company } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { useAgentStatus } from '../hooks/useAgentStatus';
import { api } from '../lib/api';
import { AccountForm } from './AccountForm';
import { AgentChoice } from './AgentChoice';
import { TerminalView } from './TerminalView';

type AgentStepProps = {
  company: Company;
  accounts: AccountsFile;
  onSave: (company: Company) => Promise<void>;
};

export function AgentStep({ company, accounts, onSave }: AgentStepProps) {
  const usable = accountsForClient(accounts.accounts, company.id);
  const account = usable.find((item) => item.id === company.defaultAccountId) ?? usable.find((item) => item.id === accounts.defaultAccountId) ?? usable[0];
  const accountId = account?.id;
  const agent = AGENT_INFO[account?.type ?? 'claude-code'];
  const { status, check } = useAgentStatus(accountId);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const { error, busy, run } = useAction();

  useEffect(() => {
    if (status?.signedIn) setTerminalId(null);
  }, [status?.signedIn]);

  const signIn = () =>
    void run(async () => {
      if (accountId) setTerminalId(await api.startAgentSignIn(accountId));
    });

  return (
    <>
      <div className="agent-status" role="status">
        {!status && <span>Checking {account?.name ?? 'your agent'}</span>}
        {status && !status.installed && (
          <>
            <strong>{agent.name} is not installed on this computer</strong>
            <span className="hint">Run this in your terminal, then reopen Hatstand so it can find {agent.name}.</span>
            <code>{agent.installCommand}</code>
            <button className="quiet" onClick={check}>
              <RefreshCw size={15} />
              Check again
            </button>
          </>
        )}
        {status?.installed && !status.signedIn && (
          <>
            <strong>{account?.name ?? agent.name} is not signed in</strong>
            <span className="hint">Sign in with the subscription you want to use. Your browser opens to finish.</span>
            <button disabled={busy} onClick={signIn}>
              <LogIn size={15} />
              Sign in
            </button>
          </>
        )}
        {status?.signedIn && (
          <>
            <strong>
              <CircleCheck size={17} />
              {account?.name ?? agent.name} is ready
            </strong>
            {status.email && (
              <span className="hint">
                Signed in as {status.email}
                {status.plan ? `, ${status.plan} plan` : ''}
              </span>
            )}
          </>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {terminalId && (
        <>
          <p className="hint">If it asks for a code, paste it in this terminal.</p>
          <div className="agent-terminal">
            <TerminalView sessionId={terminalId} />
          </div>
        </>
      )}
      <AgentChoice company={company} accounts={usable} onSave={onSave} />
      <details className="field-block">
        <summary>Add an account only for this client</summary>
        <AccountForm companyId={company.id} onAdded={(added) => onSave({ ...company, defaultAccountId: added.id })} />
      </details>
    </>
  );
}
