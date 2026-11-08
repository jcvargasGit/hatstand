import { useEffect, useState } from 'react';
import type { AgentStatus } from '../../../shared/api';
import { api } from '../lib/api';

export function useAgentStatus(accountId: string | undefined): { status: AgentStatus | null; check: () => void } {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!accountId) return;
    let active = true;
    const load = () =>
      void api
        .checkAgent(accountId)
        .then((next) => {
          if (active) setStatus(next);
        })
        .catch(() => {
          if (active) setStatus({ installed: false, signedIn: false });
        });
    load();
    window.addEventListener('focus', load);
    const stop = window.hatstand.on('state-changed', load);
    return () => {
      active = false;
      window.removeEventListener('focus', load);
      stop();
    };
  }, [accountId, attempt]);

  return { status, check: () => setAttempt((value) => value + 1) };
}
