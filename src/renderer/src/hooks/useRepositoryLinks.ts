import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/** The web page of each repository of a client that has one, by repository id. */
export function useRepositoryLinks(companyId: string): Record<string, string> {
  const [links, setLinks] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    setLinks({});
    api.repositoryLinks(companyId).then(
      (found) => {
        if (active) setLinks(found ?? {});
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [companyId]);

  return links;
}
