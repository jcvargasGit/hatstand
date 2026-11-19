import { useCallback, useEffect, useState } from 'react';
import { outsideChangesSchema, type OutsideChanges } from '../../../shared/schemas';
import { api } from '../lib/api';

const NONE: OutsideChanges = { folders: [], truncated: false };

/** The files a task changed outside git. It loads again when `refreshKey` changes, such as when the agent ends a turn. */
export function useOutsideChanges(taskId: string, refreshKey: string) {
  const [changes, setChanges] = useState<OutsideChanges>(NONE);

  const reload = useCallback(async () => {
    const found = await api.taskOutsideChanges(taskId).catch(() => NONE);
    setChanges(outsideChangesSchema.safeParse(found).data ?? NONE);
  }, [taskId]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const count = changes.folders.reduce((total, folder) => total + folder.changes.length, 0);

  return { changes, count, reload };
}
