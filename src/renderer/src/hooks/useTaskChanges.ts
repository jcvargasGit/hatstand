import { useCallback, useEffect, useState } from 'react';
import type { RepoChanges } from '../../../shared/api';
import { api } from '../lib/api';
import { useAction } from './useAction';

export function useTaskChanges(taskId: string, refreshKey: string) {
  const [reports, setReports] = useState<RepoChanges[]>([]);
  const action = useAction();
  const { run } = action;

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

  const repos = reports.filter((repo) => repo.changes.length > 0 || repo.committed.length > 0);

  return { reports, repos, reload, ...action };
}
