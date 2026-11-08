import type { PendingFolderSwitch } from '../hooks/useFolderSwitch';
import { plural } from '../lib/text';

type FolderSwitchWarningProps = {
  pending: PendingFolderSwitch;
  defaultPath: string | undefined;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function FolderSwitchWarning({ pending, defaultPath, busy, onConfirm, onCancel }: FolderSwitchWarningProps) {
  const leaving = pending.files > 0 ? `${plural(pending.files, 'file', 'files')} in ${pending.from} will stop being used. ` : `Hatstand stops using ${pending.from}. `;
  const sessions = pending.openTasks > 0 ? ` This client has ${plural(pending.openTasks, 'open task', 'open tasks')}: a running session keeps the current folder until it restarts.` : '';
  const next = pending.to ? `From now on, the context comes from ${pending.to}.` : `Hatstand goes back to the default folder${defaultPath ? `, ${defaultPath}` : ''}.`;
  return (
    <div className="warning folder-switch-warning" role="alert">
      <p>
        {leaving}
        {next}
        {sessions} Nothing is moved or deleted, and you can come back to this folder later.
      </p>
      <div className="inline-form">
        <button disabled={busy} onClick={onConfirm}>
          {pending.to ? 'Use the new folder' : 'Use the default folder'}
        </button>
        <button className="quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
