import { useCallback, useEffect, useRef, useState } from 'react';
import type { RepoChanges } from '../../../shared/api';
import { api } from '../lib/api';
import { useAction } from './useAction';

/**
 * What a task changed in its repositories. It loads again when `refreshKey` changes, and, with `pollMs`,
 * on that interval too, so the list follows the agent while it works.
 */
export function useTaskChanges(taskId: string, refreshKey: string, pollMs = 0) {
  const [reports, setReports] = useState<RepoChanges[]>([]);
  const action = useAction();
  const { run } = action;
  const loading = useRef(false);

  const reload = useCallback(
    () =>
      run(async () => {
        setReports((await api.taskChanges(taskId)) ?? []);
      }),
    [run, taskId],
  );

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  useEffect(() => {
    if (pollMs <= 0) return;
    const timer = setInterval(() => {
      if (loading.current) return;
      loading.current = true;
      void api
        .taskChanges(taskId)
        .then((found) => setReports(found ?? []))
        .catch(() => undefined)
        .finally(() => {
          loading.current = false;
        });
    }, pollMs);
    return () => clearInterval(timer);
  }, [pollMs, taskId]);

  const repos = reports.filter((repo) => repo.changes.length > 0 || repo.committed.length > 0);

  return { reports, repos, reload, ...action };
}
