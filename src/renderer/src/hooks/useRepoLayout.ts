import { useEffect, useState } from 'react';
import type { RepoLayout } from '../../../shared/api';
import { api } from '../lib/api';

export function useRepoLayout(companyId: string, projectId: string): RepoLayout | null {
  const [layout, setLayout] = useState<RepoLayout | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .inspectRepoLayout(companyId, projectId)
      .catch(() => null)
      .then((found) => {
        if (active) setLayout(found ?? null);
      });
    return () => {
      active = false;
    };
  }, [companyId, projectId]);

  return layout;
}
