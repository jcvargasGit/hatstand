import { useCallback, useEffect, useState } from 'react';
import type { PlaybookList } from '../../../shared/api';
import { api } from '../lib/api';

const EMPTY: PlaybookList = { playbooks: [], problems: [] };

export function usePlaybooks(companyId: string) {
  const [list, setList] = useState<PlaybookList>(EMPTY);

  const reload = useCallback(async () => {
    setList(await api.listPlaybooks(companyId));
  }, [companyId]);

  useEffect(() => {
    void reload();
    return window.hatstand.on('state-changed', () => void reload());
  }, [reload]);

  return { ...list, reload };
}
