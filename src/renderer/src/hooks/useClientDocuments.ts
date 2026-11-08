import { useCallback, useEffect, useState } from 'react';
import type { ClientFile } from '../../../shared/api';
import { api } from '../lib/api';
import { useAction } from './useAction';

export function useClientDocuments(companyId: string, version: string) {
  const [files, setFiles] = useState<ClientFile[]>([]);
  const [freshness, setFreshness] = useState(0);
  const action = useAction();
  const { run } = action;

  const reload = useCallback(
    () =>
      run(async () => {
        setFiles((await api.listClientFiles(companyId)) ?? []);
        setFreshness((count) => count + 1);
      }),
    [companyId, run],
  );

  useEffect(() => {
    void reload();
  }, [reload, version]);

  useEffect(() => {
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  return { files, freshness, ...action };
}
