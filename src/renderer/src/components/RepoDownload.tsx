import { useState } from 'react';
import type { RemoteRepo } from '../../../shared/api';
import type { Company } from '../../../shared/schemas';
import { GitConnectionForm } from './GitConnectionForm';
import { RepoSelection } from './RepoSelection';

export function RepoDownload({ company }: { company: Company }) {
  const [repos, setRepos] = useState<RemoteRepo[] | null>(null);
  if (!repos) return <GitConnectionForm company={company} onConnected={setRepos} />;
  return <RepoSelection company={company} repos={repos} onChangeConnection={() => setRepos(null)} />;
}
