import { useEffect, useState } from 'react';
import type { ClientFolderSection, PastFolder } from '../../../shared/api';
import { api } from '../lib/api';

export function usePastFolders(companyId: string, section: ClientFolderSection, currentPath: string | undefined): PastFolder[] {
  const [folders, setFolders] = useState<PastFolder[]>([]);

  useEffect(() => {
    let active = true;
    void api.listPastFolders(companyId, section).then((found) => {
      if (active) setFolders(found);
    });
    return () => {
      active = false;
    };
  }, [companyId, section, currentPath]);

  return folders;
}
