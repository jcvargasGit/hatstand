import { useEffect, useState } from 'react';
import type { Session, SubagentRun } from '../../../shared/schemas';
import { api } from '../lib/api';

const POLL_MS = 1500;

export function useSubagents(session: Session | undefined): SubagentRun[] {
  const [runs, setRuns] = useState<SubagentRun[]>([]);
  const sessionId = session?.id;
  const isLive = session !== undefined && session.state !== 'stopped';

  useEffect(() => {
    if (!sessionId) {
      setRuns([]);
      return;
    }
    let active = true;
    const read = async () => {
      const latest = await api.readSubagents(sessionId);
      if (active) setRuns(latest);
    };
    void read();
    const timer = isLive ? setInterval(() => void read(), POLL_MS) : undefined;
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [sessionId, isLive]);

  return runs;
}
