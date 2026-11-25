import { Globe } from 'lucide-react';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';

type RepoSiteButtonProps = {
  name: string;
  /** The page of the repository on its site. */
  webUrl: string;
};

const siteName = (url: string): string => {
  const host = new URL(url).hostname;
  return host === 'github.com' ? 'GitHub' : host.includes('gitlab') ? 'GitLab' : host;
};

/** Opens the page of a repository on GitHub or GitLab in the browser. */
export function RepoSiteButton({ name, webUrl }: RepoSiteButtonProps) {
  const { error, busy, run } = useAction();
  const site = siteName(webUrl);
  return (
    <>
      <button type="button" className="quiet icon-button" disabled={busy} title={`Open on ${site}: ${webUrl}`} aria-label={`Open ${name} on ${site}`} onClick={() => void run(() => api.openLink(webUrl))}>
        <Globe size={14} />
      </button>
      {error && <span className="error">{error}</span>}
    </>
  );
}
