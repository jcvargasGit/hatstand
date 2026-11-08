import type { Account, Company } from '../../../shared/schemas';
import { AssistantRunSettings } from './AssistantRunSettings';

type AgentChoiceProps = {
  company: Company;
  accounts: Account[];
  onSave: (company: Company) => Promise<void>;
};

export function AgentChoice({ company, accounts, onSave }: AgentChoiceProps) {
  return (
    <>
      <label className="field-block">
        <h3>Default agent</h3>
        <select
          value={company.defaultAccountId ?? ''}
          onChange={(event) => void onSave({ ...company, defaultAccountId: event.target.value || undefined })}
        >
          <option value="">Use my default</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} ({account.label})
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={company.skipPermissions}
          onChange={(event) => void onSave({ ...company, skipPermissions: event.target.checked })}
        />
        <span>
          Let agents act without asking for permission
          <small>Agents can run any command with this client&rsquo;s keys, so a mistake can reach real systems.</small>
        </span>
      </label>
      <AssistantRunSettings company={company} onSave={onSave} />
    </>
  );
}
