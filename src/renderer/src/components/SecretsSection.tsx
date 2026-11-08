import { FileUp, KeyRound, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';

export function SecretsSection({ companyId }: { companyId: string }) {
  const [names, setNames] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const { error, run } = useAction();

  const load = useCallback(async () => setNames(await api.listSecretNames(companyId)), [companyId]);

  useEffect(() => {
    void run(load);
  }, [load, run]);

  const add = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await api.setSecret(companyId, name, value);
      setName('');
      setValue('');
      await load();
    });
  };

  const importFile = () =>
    run(async () => {
      const count = await api.importEnvFile(companyId);
      if (count > 0) setMessage(`Imported ${count} keys.`);
      await load();
    });

  return (
    <section className="settings-section" id="section-keys">
      <h2>
        <KeyRound size={18} />
        Keys
      </h2>
      <p className="hint">
        Encrypted with your system keychain and given to agents only in this client&rsquo;s sessions. Jira uses
        JIRA_SITE, JIRA_EMAIL and JIRA_API_TOKEN. GitHub uses GITHUB_TOKEN. GitLab uses GITLAB_TOKEN.
      </p>
      <button className="quiet" onClick={() => void importFile()}>
        <FileUp size={15} />
        Import from an env file
      </button>
      {message && <p className="hint">{message}</p>}
      <ul className="chips">
        {names.map((item) => (
          <li key={item}>
            {item}
            <button
              className="chip-remove"
              aria-label={`Delete key ${item}`}
              onClick={() =>
                void run(async () => {
                  await api.deleteSecret(companyId, item);
                  await load();
                })
              }
            >
              <X size={13} />
            </button>
          </li>
        ))}
      </ul>
      <form className="inline-form" onSubmit={add}>
        <input aria-label="Key name" placeholder="NAME" value={name} onChange={(event) => setName(event.target.value)} />
        <input
          aria-label="Key value"
          type="password"
          placeholder="Value"
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <button className="quiet" type="submit" disabled={!name || !value}>
          <Plus size={15} />
          Add key
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
