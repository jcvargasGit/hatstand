import { useEffect, useState } from 'react';
import { gitTokenName } from '../../../shared/git-source';
import type { GitSource } from '../../../shared/schemas';
import { api } from '../lib/api';

export type SavedGitToken = 'loading' | 'saved' | 'missing';

export function useSavedGitToken(companyId: string, provider: GitSource['provider']): SavedGitToken {
  const [names, setNames] = useState<string[] | null>(null);

  useEffect(() => {
    let current = true;
    setNames(null);
    api.listSecretNames(companyId).then(
      (found) => current && setNames(found),
      () => current && setNames([]),
    );
    return () => {
      current = false;
    };
  }, [companyId]);

  if (!names) return 'loading';
  return names.includes(gitTokenName(provider)) ? 'saved' : 'missing';
}
