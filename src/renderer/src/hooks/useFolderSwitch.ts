import { useState } from 'react';
import type { ClientFolderSection, FolderSwitchImpact } from '../../../shared/api';
import { api } from '../lib/api';
import { useAction } from './useAction';

export type PendingFolderSwitch = FolderSwitchImpact & { to?: string };

export function useFolderSwitch(companyId: string, section: ClientFolderSection, apply: (path?: string) => Promise<void> | void) {
  const [pending, setPending] = useState<PendingFolderSwitch | null>(null);
  const { error, busy, run } = useAction();

  const switchTo = async (path: string) => {
    const impact = await api.folderSwitchImpact(companyId, section);
    if (impact.files > 0) setPending({ ...impact, to: path });
    else await apply(path);
  };
  const goBackToDefault = () => void run(async () => setPending(await api.folderSwitchImpact(companyId, section)));
  const confirm = () =>
    void run(async () => {
      await apply(pending?.to);
      setPending(null);
    });
  const cancel = () => setPending(null);

  return { pending, error, busy, run, switchTo, goBackToDefault, confirm, cancel };
}
