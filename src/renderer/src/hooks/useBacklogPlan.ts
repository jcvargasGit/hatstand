import { useEffect, useState } from 'react';
import type { BacklogPlanReport } from '../../../shared/api';
import { api, errorMessage } from '../lib/api';

const REFRESH_MS = 3000;

export function useBacklogPlan(taskId: string): {
  report: BacklogPlanReport | null;
  loadError: string | null;
  setReport: (report: BacklogPlanReport) => void;
} {
  const [report, setReport] = useState<BacklogPlanReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await api.readBacklogPlan(taskId);
        if (!active) return;
        setReport(next);
        setLoadError(null);
      } catch (caught) {
        if (active) setLoadError(errorMessage(caught));
      }
    };
    setReport(null);
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [taskId]);

  return { report, loadError, setReport };
}
