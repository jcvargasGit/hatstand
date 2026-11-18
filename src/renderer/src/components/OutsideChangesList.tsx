import { ExternalLink } from 'lucide-react';
import type { OutsideChange, OutsideChanges } from '../../../shared/schemas';
import { plural } from '../lib/text';

type OutsideChangesListProps = {
  changes: OutsideChanges;
  count: number;
  shownPath: string | null;
  onShow: (change: OutsideChange) => void;
  onOpen: (change: OutsideChange) => void;
};

const statusLabel = (status: OutsideChange['status']) => (status === 'repository' ? 'new repository' : status);

/** The files a task changed outside the repositories Changes reports through git, by folder, each with its full path. */
export function OutsideChangesList({ changes, count, shownPath, onShow, onOpen }: OutsideChangesListProps) {
  return (
    <div className="task-changes-repo" role="group" aria-label="Outside git">
      <p>
        <strong>Outside git</strong>
        <span className="hint">{plural(count, 'file', 'files')} outside the repositories of this task</span>
      </p>
      {changes.folders.map(({ folder, changes: files }) => (
        <div key={folder}>
          <h4>{folder}</h4>
          <ul>
            {files.map((change) => (
              <li key={change.path} className="outside-change">
                <button className="client-file" aria-current={shownPath === change.path ? 'true' : undefined} title={change.path} onClick={() => onShow(change)}>
                  <span>{change.path}</span>
                  <small>{statusLabel(change.status)}</small>
                </button>
                {change.status !== 'deleted' && (
                  <button className="quiet" aria-label={`Open ${change.path} in editor`} title="Open in editor" onClick={() => onOpen(change)}>
                    <ExternalLink size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {changes.truncated && <p className="hint">Some of these folders are too large to follow in full, so files may be missing here.</p>}
    </div>
  );
}
