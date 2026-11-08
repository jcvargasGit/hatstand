import { useCallback, useEffect, useState } from 'react';
import type { StayAwakeStatus } from '../../../shared/api';
import type { StayAwakeMode } from '../../../shared/schemas';
import { api } from '../lib/api';

export function useStayAwake() {
  const [status, setStatus] = useState<StayAwakeStatus | null>(null);

  const reload = useCallback(async () => {
    setStatus((await api.getStayAwake()) ?? null);
  }, []);

  useEffect(() => {
    void reload();
    return window.hatstand.on('state-changed', () => void reload());
  }, [reload]);

  const setMode = useCallback(
    async (mode: StayAwakeMode) => {
      await api.setStayAwake(mode);
      await reload();
    },
    [reload],
  );

  return { status, setMode };
}
