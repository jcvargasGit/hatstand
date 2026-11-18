import { Link } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { CloneProgress } from '../../../shared/api';
import { GITHUB_HOST, gitOrigin } from '../../../shared/git-source';
import type { Company } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';

function hostOrigin(company: Company): string | null {
  try {
    return gitOrigin(company.gitSource ?? GITHUB_HOST);
  } catch {
    return null;
  }
}

function resultText(result: CloneProgress, baseDir: string): string {
  if (result.state === 'existing') return `${result.path} was already in ${baseDir}, and is now in this client.`;
  return `Downloaded ${result.path} to ${baseDir}.`;
}

export function RepoLinkDownload({ company }: { company: Company }) {
  const [link, setLink] = useState('');
  const [chosenDir, setChosenDir] = useState<string | null>(null);
  const baseDir = chosenDir ?? company.rootDir ?? `~/projects/${company.id}`;
  const [result, setResult] = useState<CloneProgress | null>(null);
  const { error, busy, run } = useAction();
  const origin = hostOrigin(company);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      setResult(null);
      const downloaded = await api.downloadRepoByLink(company.id, link, baseDir);
      setResult(downloaded);
      if (downloaded.state !== 'failed') setLink('');
    });
  };

  return (
    <form className="connection-form" onSubmit={submit}>
      <h3>Download one repository from its link</h3>
      <label className="stacked-field">
        Repository link
        <input placeholder={origin ? `${origin}/company/repository` : undefined} value={link} onChange={(event) => setLink(event.target.value)} />
      </label>
      <label className="stacked-field">
        Folder for this repository
        <input value={baseDir} onChange={(event) => setChosenDir(event.target.value)} />
      </label>
      <p className="hint">
        The link must be on {origin ? new URL(origin).host : 'the GitLab of this client'}. Hatstand uses the token saved in this client&rsquo;s keys, and a public
        repository needs none. The folder must be outside any git repository.
      </p>
      {error && <p className="error">{error}</p>}
      {result?.state === 'failed' && <p className="error">{result.error}</p>}
      {result && result.state !== 'failed' && <p className="hint">{resultText(result, baseDir)}</p>}
      <div>
        <button type="submit" disabled={busy || !link.trim() || !baseDir.trim()}>
          <Link size={15} />
          {busy ? 'Downloading' : 'Download from link'}
        </button>
      </div>
    </form>
  );
}
