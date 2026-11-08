import { useCallback, useEffect, useState } from 'react';
import type { ReleaseStatus } from '../../../shared/api';
import { api } from '../lib/api';

const POLL_MS = 2000;

export function useRelease() {
  const [status, setStatus] = useState<ReleaseStatus | null>(null);

  const refresh = useCallback(async () => setStatus(await api.getReleaseStatus()), []);
  const start = useCallback(async () => {
    await api.startRelease();
    setStatus((current) => current && { ...current, state: 'building', version: current.mainVersion ?? undefined, message: undefined });
  }, []);

  useEffect(() => {
    void refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  const active = status?.state === 'building' || status?.state === 'waiting';
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [active, refresh]);

  return { status, start };
}
