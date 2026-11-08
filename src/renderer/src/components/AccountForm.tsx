import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AGENT_INFO } from '../../../shared/agents';
import { accountSchema, type Account, type Company } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { PathPicker } from './PathPicker';

type AccountFormProps = {
  title?: string;
  clients?: Company[];
  companyId?: string;
  onAdded: (account: Account) => Promise<void>;
};

export function AccountForm({ title, clients, companyId, onAdded }: AccountFormProps) {
  const [type, setType] = useState<Account['type']>('claude-code');
  const [name, setName] = useState('');
  const [label, setLabel] = useState<Account['label']>(companyId ? 'company' : 'personal');
  const [model, setModel] = useState('');
  const [configDir, setConfigDir] = useState('');
  const [onlyFor, setOnlyFor] = useState('');
  const { error, busy, run } = useAction();

  const add = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const account = accountSchema.parse({
        id: crypto.randomUUID(),
        name,
        type,
        label,
        model: model.trim() || undefined,
        configDir: configDir || undefined,
        companyId: companyId ?? (onlyFor || undefined),
      });
      await api.saveAccount(account);
      setName('');
      setModel('');
      setConfigDir('');
      setOnlyFor('');
      await onAdded(account);
    });
  };

  return (
    <form className="settings-section stacked" onSubmit={add}>
      {title && <h2>{title}</h2>}
      <label>
        Agent
        <select value={type} onChange={(event) => setType(event.target.value as Account['type'])}>
          {Object.entries(AGENT_INFO).map(([value, agent]) => (
            <option key={value} value={value}>
              {agent.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Name
        <input placeholder={`${AGENT_INFO[type].name}, work subscription`} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Who pays for it
        <select value={label} onChange={(event) => setLabel(event.target.value as Account['label'])}>
          <option value="personal">Personal</option>
          <option value="company">Company</option>
        </select>
      </label>
      {clients && (
        <label>
          Who can use it
          <select value={onlyFor} onChange={(event) => setOnlyFor(event.target.value)}>
            <option value="">Every client</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                Only {client.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Model (optional)
        <input placeholder="Leave empty for the account default" value={model} onChange={(event) => setModel(event.target.value)} />
      </label>
      <div className="field-block">
        <h3>Sign-in folder (optional)</h3>
        <p className="hint">
          Use a separate folder for a second {AGENT_INFO[type].name} login. Sign in once with
          <code> {AGENT_INFO[type].signInExample}</code>.
        </p>
        {configDir && <p className="path">{configDir}</p>}
        <PathPicker kind="directory" label="Sign-in folder" browseLabel="Choose folder" onSelect={setConfigDir} />
      </div>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy || !name.trim()}>
        <Plus size={16} />
        Add account
      </button>
    </form>
  );
}
