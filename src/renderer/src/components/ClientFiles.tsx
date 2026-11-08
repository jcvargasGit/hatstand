import { useEffect, useState } from 'react';
import type { ClientFileScope } from '../../../shared/api';
import { useClientDocuments } from '../hooks/useClientDocuments';
import { useEditorName } from '../hooks/useEditorName';
import { api } from '../lib/api';
import { buildFileTree } from '../lib/file-tree';
import { plural } from '../lib/text';
import { DocumentPreview } from './DocumentPreview';
import { FileTree } from './FileTree';

type ClientFilesProps = {
  companyId: string;
  scope: ClientFileScope;
  refreshKey: string;
  onOpenTask: (taskId: string) => Promise<void>;
  openPath?: string | null;
  onOpened?: () => void;
  title?: string;
  hint?: string;
  onlyFolder?: string;
  bare?: boolean;
};

const FILTER_FROM = 12;

export function ClientFiles({ companyId, scope, refreshKey, onOpenTask, openPath, onOpened, title = 'Files', hint, onlyFolder, bare = false }: ClientFilesProps) {
  const { files: allFiles, freshness, error, run } = useClientDocuments(companyId, refreshKey);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const editorName = useEditorName();
  const files = allFiles.filter((file) => file.scope === scope && (!onlyFolder || file.folder.endsWith(onlyFolder)));
  const term = filter.trim().toLowerCase();
  const shown = files.filter((file) => file.name.toLowerCase().includes(term));
  const selected = files.find((file) => file.path === selectedPath);
  const tree = buildFileTree(shown);
  const nodes = onlyFolder ? tree.flatMap((root) => root.children) : tree;

  useEffect(() => {
    if (!openPath || !allFiles.some((file) => file.path === openPath)) return;
    setSelectedPath(openPath);
    onOpened?.();
    void run(async () => void (await api.openClientFileInEditor(companyId, openPath)));
  }, [openPath, allFiles, companyId, run]);

  if (files.length === 0) return null;

  return (
    <div className="client-files">
      {!bare && (
        <>
          <h3>{title}</h3>
          <p className="hint">
        {plural(files.length, 'file', 'files')}. {hint ?? 'Look at them here, and open them in your editor to change them.'}
          </p>
        </>
      )}
      {files.length >= FILTER_FROM && <input aria-label="Filter files" placeholder="Filter by name" value={filter} onChange={(event) => setFilter(event.target.value)} />}
      <div className="doc-explorer">
        <aside className="doc-explorer-tree">
          <FileTree nodes={nodes} selectedPath={selected?.path ?? null} changedPaths={[]} onSelect={(file) => setSelectedPath(file.path)} />
        </aside>
        {selected ? (
          <DocumentPreview key={selected.path} companyId={companyId} file={selected} freshness={freshness} editorName={editorName} onOpenTask={onOpenTask} />
        ) : (
          <div className="doc-preview-empty">
            <p className="hint">Choose a file on the left to see it here.</p>
          </div>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
