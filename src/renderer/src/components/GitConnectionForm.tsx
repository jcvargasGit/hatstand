import { ExternalLink, PlugZap } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { RemoteRepo } from '../../../shared/api';
import { gitTokenName, tokenPageUrl } from '../../../shared/git-source';
import { keyServicePermissions } from '../../../shared/known-keys';
import type { Company, GitSource } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { useSavedGitToken } from '../hooks/useSavedGitToken';
import { api } from '../lib/api';

const OWNER_LABEL: Record<GitSource['provider'], string> = {
  github: 'Organization or user',
  gitlab: 'Group or user',
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
  listError: string | null;
  onConnected: (repos: RemoteRepo[]) => void;
};

export function GitConnectionForm({ company, listError, onConnected }: GitConnectionFormProps) {
  const saved = company.gitSource;
  const [provider, setProvider] = useState<GitSource['provider']>(saved?.provider ?? 'github');
  const [host, setHost] = useState(saved?.host ?? '');
  const [owner, setOwner] = useState(saved?.owner ?? '');
  const [token, setToken] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { error, busy, run } = useAction();
  const tokenState = useSavedGitToken(company.id, provider);
  const asksForToken = tokenState === 'missing' || replacing;
  const shownError = error ?? (submitted ? null : listError);
  const link = tokenLink({ provider, host });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    void run(async () => {
      const source: GitSource = { provider, owner, host: provider === 'gitlab' && host.trim() ? host : undefined };
      onConnected(await api.connectGitSource(company.id, source, (asksForToken && token) || undefined));
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
        {OWNER_LABEL[provider]}
        <input value={owner} onChange={(event) => setOwner(event.target.value)} />
      </label>
      {asksForToken && (
        <label className="stacked-field">
          Access token
          <input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} />
        </label>
      )}
      {tokenState === 'saved' && !replacing && (
        <p className="file-row">
          <span className="hint">Using the {gitTokenName(provider)} saved in this client&rsquo;s keys.</span>
          <button type="button" className="quiet" onClick={() => setReplacing(true)}>
            Replace token
          </button>
        </p>
      )}
      <p className="hint">
        {keyServicePermissions(provider)} It is encrypted with your system keychain and used only for this client.{' '}
        {link && (
          <a href={link} target="_blank" rel="noreferrer">
            Create a token <ExternalLink size={12} />
          </a>
        )}
      </p>
      {shownError && <p className="error">{shownError}</p>}
      <button type="submit" disabled={busy || !owner.trim()}>
        <PlugZap size={15} />
        {busy ? 'Connecting' : 'Connect and list repositories'}
      </button>
    </form>
  );
}
