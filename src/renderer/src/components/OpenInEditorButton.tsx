import { Code2, ExternalLink } from 'lucide-react';
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
  /** Shows only the icon, for a row with little room. The name stays for people who do not see it. */
  iconOnly?: boolean;
};

/** Opens a folder of the client in the editor that is installed, and names that editor. */
export function OpenInEditorButton({ companyId, path, what, label, iconOnly = false }: OpenInEditorButtonProps) {
  const { error, busy, run } = useAction();
  const editor = useEditorName() ?? 'your editor';
  return (
    <>
      <button
        type="button"
        className={iconOnly ? 'quiet icon-button' : 'quiet'}
        disabled={busy}
        title={iconOnly ? `${label ?? `Open in ${editor}`}: ${path}` : path}
        aria-label={`Open ${what} in ${editor}`}
        onClick={() => void run(() => api.openInEditor(companyId, path))}
      >
        {iconOnly ? <Code2 size={14} /> : <ExternalLink size={14} />}
        {!iconOnly && (label ?? `Open in ${editor}`)}
      </button>
      {error && <span className="error">{error}</span>}
    </>
  );
}
