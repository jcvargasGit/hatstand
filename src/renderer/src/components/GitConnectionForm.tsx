import { ExternalLink, PlugZap } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { RemoteRepo } from '../../../shared/api';
import { tokenPageUrl } from '../../../shared/git-source';
import type { Company, GitSource } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';

const PROVIDER_TEXT: Record<GitSource['provider'], { owner: string; permissions: string }> = {
  github: {
    owner: 'Organization or user',
    permissions: 'The token needs the repo and read:org permissions.',
  },
  gitlab: {
    owner: 'Group or user',
    permissions: 'The token needs the read_api and write_repository permissions.',
  },
};

function tokenLink(source: Pick<GitSource, 'provider' | 'host'>): string | null {
  try {
    return tokenPageUrl(source);
  } catch {
    return null;
  }
}

type GitConnectionFormProps = {
  company: Company;
  onConnected: (repos: RemoteRepo[]) => void;
};

export function GitConnectionForm({ company, onConnected }: GitConnectionFormProps) {
  const saved = company.gitSource;
  const [provider, setProvider] = useState<GitSource['provider']>(saved?.provider ?? 'github');
  const [host, setHost] = useState(saved?.host ?? '');
  const [owner, setOwner] = useState(saved?.owner ?? '');
  const [token, setToken] = useState('');
  const { error, busy, run } = useAction();
  const text = PROVIDER_TEXT[provider];
  const link = tokenLink({ provider, host });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const source: GitSource = { provider, owner, host: provider === 'gitlab' && host.trim() ? host : undefined };
      onConnected(await api.connectGitSource(company.id, source, token || undefined));
    });
  };

  return (
    <form className="connection-form" onSubmit={submit}>
      <label className="stacked-field">
        Where is the code hosted?
        <select value={provider} onChange={(event) => setProvider(event.target.value as GitSource['provider'])}>
          <option value="github">GitHub</option>
          <option value="gitlab">GitLab</option>
        </select>
      </label>
      {provider === 'gitlab' && (
        <label className="stacked-field">
          GitLab address (only if the company has its own)
          <input placeholder="https://gitlab.com" value={host} onChange={(event) => setHost(event.target.value)} />
        </label>
      )}
      <label className="stacked-field">
        {text.owner}
        <input value={owner} onChange={(event) => setOwner(event.target.value)} />
      </label>
      <label className="stacked-field">
        Access token
        <input
          type="password"
          autoComplete="off"
          placeholder={saved ? 'Leave empty to keep the saved token' : undefined}
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      </label>
      <p className="hint">
        {text.permissions} It is encrypted with your system keychain and used only for this client.{' '}
        {link && (
          <a href={link} target="_blank" rel="noreferrer">
            Create a token <ExternalLink size={12} />
          </a>
        )}
      </p>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy || !owner.trim()}>
        <PlugZap size={15} />
        {busy ? 'Connecting' : 'Connect and list repositories'}
      </button>
    </form>
  );
}
