import { Upload } from 'lucide-react';
import type { ReleaseStatus } from '../../../shared/api';
import { useRelease } from '../hooks/useRelease';

function statusText({ state, version, message, installedVersion, mainVersion }: ReleaseStatus): string {
  if (state === 'building') return `Building version ${version}. Your sessions keep running.`;
  if (state === 'waiting') return `Version ${version} is ready. It installs when you close Hatstand.`;
  if (state === 'failed') return message ?? 'The update failed. Try again.';
  if (installedVersion === mainVersion) return `The installed app is up to date, version ${installedVersion}.`;
  if (!installedVersion) return `The app is not installed yet. This installs version ${mainVersion}.`;
  return `Installed ${installedVersion}. Main is at ${mainVersion}.`;
}

export function ReleaseControl() {
  const { status, start } = useRelease();
  if (!status) return null;
  const upToDate = status.installedVersion === status.mainVersion && status.state !== 'failed';
  const waitingForSameVersion = status.state === 'waiting' && status.version === status.mainVersion;
  const disabled = status.state === 'building' || waitingForSameVersion || upToDate;
  const outside = status.commitsOutsideMain;
  return (
    <div className="release-control">
      <button className="nav-row" disabled={disabled} onClick={() => void start()}>
        <Upload size={16} />
        <span className="nav-name">Update installed app</span>
      </button>
      <small role="status">{statusText(status)}</small>
      {outside > 0 && <small>{outside === 1 ? '1 commit here is' : `${outside} commits here are`} not in main yet, so the update leaves them out.</small>}
    </div>
  );
}
