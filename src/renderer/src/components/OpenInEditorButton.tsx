import { ExternalLink } from 'lucide-react';
import { useAction } from '../hooks/useAction';
import { useEditorName } from '../hooks/useEditorName';
import { api } from '../lib/api';

type OpenInEditorButtonProps = {
  companyId: string;
  /** The folder to open. */
  path: string;
  /** What opens, such as "hatstand" or "the copy of hatstand", for people who do not see the button. */
  what: string;
  /** Replaces "Open in Cursor", such as "Open original". */
  label?: string;
};

/** Opens a folder of the client in the editor that is installed, and names that editor. */
export function OpenInEditorButton({ companyId, path, what, label }: OpenInEditorButtonProps) {
  const { error, busy, run } = useAction();
  const editor = useEditorName() ?? 'your editor';
  return (
    <>
      <button type="button" className="quiet" disabled={busy} title={path} aria-label={`Open ${what} in ${editor}`} onClick={() => void run(() => api.openInEditor(companyId, path))}>
        <ExternalLink size={14} />
        {label ?? `Open in ${editor}`}
      </button>
      {error && <span className="error">{error}</span>}
    </>
  );
}
