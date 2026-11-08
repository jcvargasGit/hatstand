import { useCallback, useEffect, useState } from 'react';
import type { Snapshot } from '../../../shared/api';
import { api } from '../lib/api';

export function useSnapshot(): { snapshot: Snapshot | null; refresh: () => Promise<void> } {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  const refresh = useCallback(async () => {
    setSnapshot(await api.getSnapshot());
  }, []);

  useEffect(() => {
    void refresh();
    const refreshOnFocus = () => void refresh();
    window.addEventListener('focus', refreshOnFocus);
    const stop = window.hatstand.on('state-changed', () => void refresh());
    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      stop();
    };
  }, [refresh]);

  return { snapshot, refresh };
}
