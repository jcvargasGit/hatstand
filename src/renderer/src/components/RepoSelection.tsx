import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CloneProgress, RemoteRepo } from '../../../shared/api';
import type { Company } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { plural } from '../lib/text';

const STATE_TEXT: Record<CloneProgress['state'], string> = {
  cloning: 'Downloading',
  cloned: 'Downloaded',
  existing: 'Already on this computer',
  failed: 'Failed',
};

type RepoSelectionProps = {
  company: Company;
  repos: RemoteRepo[];
  onChangeConnection: () => void;
};

export function RepoSelection({ company, repos, onChangeConnection }: RepoSelectionProps) {
  const available = repos.filter((repo) => !repo.archived);
  const isAdded = (path: string) => company.projects.some((project) => project.name === path);
  const [selected, setSelected] = useState(() => new Set(available.filter((repo) => !isAdded(repo.path)).map((repo) => repo.path)));
  const [filter, setFilter] = useState('');
  const [baseDir, setBaseDir] = useState(company.rootDir ?? `~/projects/${company.id}`);
  const [progress, setProgress] = useState<Record<string, CloneProgress>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const { error, busy, run } = useAction();
  const visible = available.filter((repo) => repo.path.toLowerCase().includes(filter.trim().toLowerCase()));

  useEffect(
    () =>
      window.hatstand.on('clone-progress', ({ companyId, ...item }) => {
        if (companyId === company.id) setProgress((current) => ({ ...current, [item.path]: item }));
      }),
    [company.id],
  );

  const toggle = (path: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const setVisible = (checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      visible.forEach((repo) => (checked ? next.add(repo.path) : next.delete(repo.path)));
      return next;
    });

  const download = () =>
    void run(async () => {
      setProgress({});
      setSummary(null);
      const results = await api.downloadRepos(company.id, baseDir, [...selected]);
      const failed = results.filter((item) => item.state === 'failed');
      setSelected(new Set(failed.map((item) => item.path)));
      setSummary(
        `Ready: ${plural(results.length - failed.length, 'repository', 'repositories')}.` +
          (failed.length ? ` ${failed.length} failed, and you can try them again.` : ''),
      );
    });

  return (
    <div className="repo-selection">
      <div className="selection-actions">
        <span className="hint">
          Found {plural(available.length, 'repository', 'repositories')} in {company.gitSource?.owner}
          {repos.length > available.length ? `. ${plural(repos.length - available.length, 'archived one is', 'archived ones are')} hidden.` : '.'}
        </span>
        <button className="quiet" disabled={busy} onClick={onChangeConnection}>
          Change connection
        </button>
      </div>
      <input aria-label="Filter repositories" placeholder="Filter by name" value={filter} onChange={(event) => setFilter(event.target.value)} />
      <div className="selection-actions">
        <button className="quiet" disabled={busy} onClick={() => setVisible(true)}>
          Select all
        </button>
        <button className="quiet" disabled={busy} onClick={() => setVisible(false)}>
          Clear
        </button>
      </div>
      <ul className="repo-list">
        {visible.map((repo) => {
          const item = progress[repo.path];
          return (
            <li key={repo.path}>
              <label className="repo-row">
                <input type="checkbox" disabled={busy} checked={selected.has(repo.path)} onChange={() => toggle(repo.path)} />
                <span>
                  {repo.path}
                  {repo.description && <small>{repo.description}</small>}
                </span>
                {item ? (
                  <span className={item.state === 'failed' ? 'repo-state is-failed' : 'repo-state'}>
                    {item.error ?? STATE_TEXT[item.state]}
                  </span>
                ) : (
                  isAdded(repo.path) && <span className="repo-state">Added</span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
      <label className="stacked-field">
        Download to
        <input value={baseDir} onChange={(event) => setBaseDir(event.target.value)} />
      </label>
      <p className="hint">Hatstand creates this folder if needed. It must be outside any git repository.</p>
      {error && <p className="error">{error}</p>}
      {summary && <p className="hint">{summary}</p>}
      <div>
        <button disabled={busy || selected.size === 0 || !baseDir.trim()} onClick={download}>
          <Download size={15} />
          {busy ? 'Downloading' : `Download ${plural(selected.size, 'repository', 'repositories')}`}
        </button>
      </div>
    </div>
  );
}
