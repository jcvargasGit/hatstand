import { Trash2 } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import type { BlockedFolder } from '../../../shared/api';
import { useAction } from '../hooks/useAction';
import { api, errorMessage } from '../lib/api';
import { plural } from '../lib/text';

type RepoFolderBlockedProps = {
  companyId: string;
  baseDir: string;
  repoPath: string;
  /** Downloads the repository again, once its folder is in the trash. */
  onDownload: () => Promise<void>;
  onCancel: () => void;
};

function contents(folder: BlockedFolder): string {
  if (folder.blocker === 'not-a-repository') {
    return `${folder.target} is not a git repository. It holds ${plural(folder.entries, 'file or folder', 'files and folders')}.`;
  }
  return `${folder.target} holds another repository${folder.origin ? `, from ${folder.origin}` : ''}.`;
}

function localWork(folder: BlockedFolder): string | null {
  if (folder.blocker === 'not-a-repository') return null;
  const parts = [
    folder.uncommitted > 0 && `${plural(folder.uncommitted, 'file has', 'files have')} changes that are not committed`,
    folder.unpushed > 0 && `${plural(folder.unpushed, 'commit is', 'commits are')} on no remote`,
  ].filter(Boolean);
  return parts.length > 0 ? `Only on this computer: ${parts.join(', and ')}.` : 'Hatstand found no changes that are only on this computer.';
}

export function RepoFolderBlocked({ companyId, baseDir, repoPath, onDownload, onCancel }: RepoFolderBlockedProps) {
  const name = repoPath.split('/').at(-1) ?? repoPath;
  const [folder, setFolder] = useState<BlockedFolder | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const { error, busy, run } = useAction();
  const inputId = useId();

  useEffect(() => {
    let current = true;
    api.inspectBlockedFolder(companyId, baseDir, repoPath).then(
      (found) => current && setFolder(found),
      (caught) => current && setInspectError(errorMessage(caught)),
    );
    return () => {
      current = false;
    };
  }, [companyId, baseDir, repoPath]);

  const confirmed = typed.trim() === name;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed) return;
    void run(async () => {
      await api.trashBlockedFolder(companyId, baseDir, repoPath, typed);
      await onDownload();
    });
  };

  const work = folder && localWork(folder);
  return (
    <form className="warning folder-switch-warning repo-folder-blocked motion-enter" role="alert" onSubmit={submit}>
      {!folder && !inspectError && (
        <div role="status" aria-busy="true">
          <span className="visually-hidden">Reading the folder</span>
          <div className="skeleton skeleton-text" style={{ width: '70%' }} />
          <div className="skeleton skeleton-text" style={{ width: '45%' }} />
        </div>
      )}
      {inspectError && <p className="error">{inspectError}</p>}
      {folder && (
        <>
          <p>{contents(folder)}</p>
          {work && <p>{work}</p>}
          <p>
            Hatstand moves the whole folder to the trash of this computer, and downloads {name} in its place. You can get the folder back from the trash until you
            empty it.
          </p>
          <label className="stacked-field" htmlFor={inputId}>
            Type {name} to confirm
            <input id={inputId} autoComplete="off" spellCheck={false} disabled={busy} value={typed} onChange={(event) => setTyped(event.target.value)} />
          </label>
        </>
      )}
      {error && <p className="error">{error}</p>}
      <div className="inline-form">
        {folder && (
          <button type="submit" disabled={busy || !confirmed}>
            <Trash2 size={15} />
            {busy ? 'Working' : 'Move to trash and download again'}
          </button>
        )}
        <button type="button" className="quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
