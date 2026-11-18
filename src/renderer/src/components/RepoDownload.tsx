import { useEffect, useRef, useState } from 'react';
import type { RemoteRepo } from '../../../shared/api';
import type { Company } from '../../../shared/schemas';
import { useSavedGitToken } from '../hooks/useSavedGitToken';
import { api, errorMessage } from '../lib/api';
import { GitConnectionForm } from './GitConnectionForm';
import { RepoSelection } from './RepoSelection';

export function RepoDownload({ company }: { company: Company }) {
  const source = company.gitSource;
  const savedToken = useSavedGitToken(company.id, source?.provider ?? 'github');
  const [repos, setRepos] = useState<RemoteRepo[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const listed = useRef(false);
  const usesSavedConnection = Boolean(source) && savedToken !== 'missing' && !changing && !listError;

  useEffect(() => {
    if (!source || savedToken !== 'saved' || listed.current) return;
    listed.current = true;
    api.connectGitSource(company.id, source).then(setRepos, (error) => setListError(errorMessage(error)));
  }, [company.id, source, savedToken]);

  if (repos) {
    return (
      <RepoSelection
        company={company}
        repos={repos}
        onChangeConnection={() => {
          setRepos(null);
          setChanging(true);
        }}
      />
    );
  }
  if (usesSavedConnection) return <p className="hint">Listing repositories</p>;
  return <GitConnectionForm company={company} listError={listError} onConnected={setRepos} />;
}
