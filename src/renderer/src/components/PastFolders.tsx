import type { PastFolder } from '../../../shared/api';

type PastFoldersProps = {
  folders: PastFolder[];
  busy: boolean;
  onUse: (path: string) => void;
};

export function PastFolders({ folders, busy, onUse }: PastFoldersProps) {
  if (folders.length === 0) return null;
  return (
    <div className="past-folders">
      <h4>Used before</h4>
      <ul>
        {folders.map((folder) => (
          <li key={folder.path}>
            <span className="past-folder-name">
              <span className="path">{folder.path}</span>
              <span className="hint">{folder.exists ? `Until ${new Date(folder.leftAt).toLocaleDateString()}` : 'This folder no longer exists'}</span>
            </span>
            {folder.exists && (
              <button className="quiet" disabled={busy} aria-label={`Use ${folder.path} again`} onClick={() => onUse(folder.path)}>
                Use again
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
