import { useCallback, useEffect, useState } from 'react';
import { canCheckKey, CUSTOM_KEY_PURPOSE, KEY_SERVICES, KNOWN_KEYS, keyServicePermissions, knownKey, renewalUrl } from '../../../shared/known-keys';
import type { GitSource, KeyInfo } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { AddKeyForm } from './AddKeyForm';
import { KeyRow } from './KeyRow';

type SecretsSectionProps = {
  companyId: string;
  /** The GitLab of this client, so the link to create a token opens the right address. */
  gitSource?: GitSource;
};

export function SecretsSection({ companyId, gitSource }: SecretsSectionProps) {
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const { error, run } = useAction();

  const load = useCallback(async () => setKeys(await api.listKeys(companyId)), [companyId]);

  useEffect(() => {
    void run(load);
    return window.hatstand.on('state-changed', () => void run(load));
  }, [load, run]);

  const now = new Date();
  const savedNames = keys.map((key) => key.name);
  const custom = keys.filter((key) => !knownKey(key.name));

  const save = async (name: string, value: string) => {
    await api.setSecret(companyId, name, value);
    await load();
  };

  const row = (name: string) => {
    const known = knownKey(name);
    const info = keys.find((key) => key.name === name);
    const renewal = known?.isToken
      ? { url: renewalUrl(known.service, gitSource), permissions: keyServicePermissions(known.service) }
      : undefined;
    // Asked once the key is saved, so a key that is being added counts as saved here.
    const checkable = canCheckKey(name, [...savedNames, name]);
    return (
      <KeyRow
        key={name}
        name={name}
        info={info}
        purpose={known?.purpose ?? CUSTOM_KEY_PURPOSE}
        isSecret={!known || known.isToken}
        renewal={renewal}
        now={now}
        onSave={(value) => save(name, value)}
        onCheck={
          checkable
            ? async () => {
                try {
                  await api.checkKey(companyId, name);
                } finally {
                  await load();
                }
              }
            : undefined
        }
        onDelete={async () => {
          await api.deleteSecret(companyId, name);
          await load();
        }}
        onNote={
          known
            ? undefined
            : async (note) => {
                await api.setKeyNote(companyId, name, note);
                await load();
              }
        }
      />
    );
  };

  return (
    <section className="settings-section" id="section-keys">
      {KEY_SERVICES.map((service) => (
        <div className="key-group" key={service.id}>
          <h3 id={`keys-${service.id}`}>{service.name}</h3>
          <ul className="key-list" aria-labelledby={`keys-${service.id}`}>
            {KNOWN_KEYS.filter((key) => key.service === service.id && (!key.isAlias || savedNames.includes(key.name))).map((key) => row(key.name))}
          </ul>
        </div>
      ))}
      <div className="key-group">
        <h3 id="keys-other">Other keys</h3>
        <p className="hint">Any other value this client&rsquo;s agents need, such as an API key. Agents read it as an environment variable.</p>
        {custom.length > 0 && (
          <ul className="key-list" aria-labelledby="keys-other">
            {custom.map((key) => row(key.name))}
          </ul>
        )}
        <AddKeyForm
          onAdd={save}
          onImport={async () => {
            const count = await api.importEnvFile(companyId);
            await load();
            return count;
          }}
        />
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
