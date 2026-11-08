import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { GuardReport, RepoGuardStatus } from '../../../shared/api';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { plural } from '../lib/text';

export function CommitProtection({ companyId }: { companyId: string }) {
  const [guard, setGuard] = useState<GuardReport | null>(null);
  const [repos, setRepos] = useState<RepoGuardStatus[]>([]);
  const { error, busy, run } = useAction();
  const { error: statusError, run: runStatus } = useAction();

  useEffect(() => {
    void runStatus(async () => setRepos(await api.guardStatus(companyId)));
  }, [companyId, runStatus]);

  const protect = (keepExistingHooks: string[] = []) =>
    run(async () => {
      setGuard(await api.installGuard(companyId, keepExistingHooks));
      setRepos(await api.guardStatus(companyId));
    });

  const covered = repos.filter((repo) => repo.state === 'protected');
  const open = repos.filter((repo) => repo.state !== 'protected');

  return (
    <section className="settings-section" id="section-protection">
      <button className="quiet" disabled={busy} onClick={() => void protect()}>
        <ShieldCheck size={15} />
        {busy ? 'Protecting' : 'Protect repositories'}
      </button>
      {guard && (
        <p className="hint">
          Protected {plural(guard.installed.length, 'repository', 'repositories')}, covering {plural(guard.secrets, 'key', 'keys')}{' '}
          and {plural(guard.knowledgeLines, 'line', 'lines')} of knowledge and LLM config.
        </p>
      )}
      {repos.length > 0 && (
        <p className="guard-summary">
          {covered.length} of {plural(repos.length, 'repository', 'repositories')} protected.
        </p>
      )}
      {open.length > 0 && covered.length + (guard ? 1 : 0) > 0 && (
        <table className="project-table">
          <caption className="guard-caption">Not protected</caption>
          <thead>
            <tr>
              <th scope="col">Repository</th>
              <th scope="col">Why</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {open.map((repo) => (
              <tr key={repo.path}>
                <td title={repo.path}>{repo.name}</td>
                <td>{repo.reason ?? 'Not added yet. Use Protect repositories.'}</td>
                <td>
                  {repo.state === 'existing-hook' && (
                    <button className="quiet" disabled={busy} onClick={() => void protect([repo.path])}>
                      Protect and keep its hook
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open.some((repo) => repo.state === 'existing-hook') && (
        <p className="hint">Protect and keep its hook runs this check first, then the hook the repository already had.</p>
      )}
      {covered.length > 0 && (
        <details className="guard-covered">
          <summary>Protected repositories</summary>
          <ul>
            {covered.map((repo) => (
              <li key={repo.path} title={repo.path}>
                {repo.name}
              </li>
            ))}
          </ul>
        </details>
      )}
      {(error ?? statusError) && <p className="error">{error ?? statusError}</p>}
    </section>
  );
}
