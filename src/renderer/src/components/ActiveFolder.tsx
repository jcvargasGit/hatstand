import { FolderOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ClientFolderSection } from '../../../shared/api';
import { useFolderSwitch } from '../hooks/useFolderSwitch';
import { usePastFolders } from '../hooks/usePastFolders';
import { api } from '../lib/api';
import { FolderSwitchWarning } from './FolderSwitchWarning';
import { PastFolders } from './PastFolders';
import { PathPicker } from './PathPicker';

type ActiveFolderProps = {
  companyId: string;
  section: ClientFolderSection;
  title: string;
  hint: string;
  defaultPath: string | undefined;
  customPath: string | undefined;
  warnInsideGit?: boolean;
  warnNotPlugin?: boolean;
  onChange: (path?: string) => Promise<void> | void;
};

export function ActiveFolder({ companyId, section, title, hint, defaultPath, customPath, warnInsideGit = false, warnNotPlugin = false, onChange }: ActiveFolderProps) {
  const { pending, error, busy, run, switchTo, goBackToDefault, confirm, cancel } = useFolderSwitch(companyId, section, onChange);
  const [warning, setWarning] = useState<string | null>(null);
  const pastFolders = usePastFolders(companyId, section, customPath);

  useEffect(() => {
    setWarning(null);
    if (!customPath) return;
    let active = true;
    void (async () => {
      if (warnInsideGit && (await api.isInsideGitRepo(customPath))) {
        if (active) setWarning('This folder is inside a git repository, so it could be committed there.');
      } else if (warnNotPlugin && (await api.isPluginFolder(customPath)) === false) {
        if (active) setWarning('This folder has no skills, agents, commands, hooks or MCP servers that an agent can load.');
      }
    })();
    return () => {
      active = false;
    };
  }, [customPath, warnInsideGit, warnNotPlugin]);

  return (
    <div className="field-block active-folder">
      <h3>{title}</h3>
      <p className="hint">{hint}</p>
      <p className="file-row">
        <span className="repo-chip">{customPath ? 'Custom' : 'Default'}</span>
        <span className="path">{customPath ?? defaultPath}</span>
        <button className="quiet" onClick={() => void run(() => api.openClientFolder(companyId, section))}>
          <FolderOpen size={15} />
          Open folder
        </button>
        {customPath && (
          <button className="quiet" disabled={busy} onClick={goBackToDefault}>
            Go back to the default folder
          </button>
        )}
      </p>
      {warning && <p className="warning path-warning">{warning}</p>}
      {pending ? (
        <FolderSwitchWarning pending={pending} defaultPath={defaultPath} busy={busy} onConfirm={confirm} onCancel={cancel} />
      ) : (
        <PathPicker kind="directory" label={title} browseLabel={customPath ? 'Choose another folder' : 'Use a custom folder'} onSelect={switchTo} />
      )}
      {!pending && <PastFolders folders={pastFolders} busy={busy} onUse={(path) => void run(() => switchTo(path))} />}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
