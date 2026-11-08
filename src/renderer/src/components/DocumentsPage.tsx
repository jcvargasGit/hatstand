import { ExternalLink, FilePlus, FolderOpen } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { ClientFile, ClientFileScope, RepoChanges, Snapshot } from '../../../shared/api';
import type { Company } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { useClientDocuments } from '../hooks/useClientDocuments';
import { useEditorName } from '../hooks/useEditorName';
import { api } from '../lib/api';
import { buildFileTree } from '../lib/file-tree';
import { plural } from '../lib/text';
import { DocumentPreview } from './DocumentPreview';
import { FileTree } from './FileTree';
import { areaFolder } from '../../../shared/areas';

type DocumentsPageProps = {
  snapshot: Snapshot;
  company: Company;
  initialPath?: string;
  onOpenClient: (companyId: string) => void;
  onOpenTask: (taskId: string) => Promise<void>;
};

const SECTIONS: { scope: ClientFileScope; title: string; hint: string }[] = [
  { scope: 'planning', title: 'Planning', hint: 'Specs, tickets and decisions your team shares. They reach git only when you, or an agent you asked, commit them.' },
  { scope: 'knowledge', title: 'Knowledge', hint: 'Private to you. Commit protection keeps it out of every repository.' },
  { scope: 'llm-config', title: 'LLM config', hint: 'Private to you, and used by this client’s agents in every session.' },
  { scope: 'guides', title: 'Task guides', hint: 'This client’s copies and new guides.' },
  { scope: 'areas', title: 'Areas', hint: 'Private to you. Instructions, notes and tips of each area.' },
];

const PRIVATE_PLANNING_HINT = 'Private to you, on this computer. Commit protection keeps it out of every repository.';

export function DocumentsPage({ snapshot, company, initialPath, onOpenClient, onOpenTask }: DocumentsPageProps) {
  const planning = company.planning;
  const [scope, setScope] = useState<ClientFileScope>(planning ? 'planning' : 'knowledge');
  const [selected, setSelected] = useState<ClientFile | null>(null);
  const [wanted, setWanted] = useState<string | null>(initialPath ?? null);
  const [name, setName] = useState('');
  const [where, setWhere] = useState(planning?.places[0]?.folder ?? (planning ? '.' : 'knowledge'));
  const [status, setStatus] = useState<RepoChanges | null>(null);
  const [created, setCreated] = useState(0);
  const [opened, setOpened] = useState<string | null>(null);
  const { error, busy, run } = useAction();
  const editorName = useEditorName();
  const version = `${snapshot.tasks.length}:${created}`;
  const { files, freshness, error: filesError } = useClientDocuments(company.id, version);
  const planningPath = planning?.path;
  const section = SECTIONS.find((item) => item.scope === scope);
  const sectionHint = scope === 'planning' && !planning ? PRIVATE_PLANNING_HINT : section?.hint;
  const shown = files.filter((file) => file.scope === scope);

  useEffect(() => setWanted(initialPath ?? null), [initialPath]);

  useEffect(() => {
    const file = wanted ? files.find((item) => item.path === wanted) : undefined;
    if (!file) return;
    setScope(file.scope);
    setSelected(file);
    setWanted(null);
  }, [wanted, files]);

  useEffect(() => {
    if (planningPath) void run(async () => setStatus((await api.planningStatus(company.id)) ?? null));
  }, [company.id, planningPath, run, version, freshness]);

  const create = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const path = await api.createDocument(company.id, where, name);
      setWanted(path);
      setName('');
      setCreated((count) => count + 1);
      setOpened(await api.openClientFileInEditor(company.id, path));
    });
  };

  const changed = planningPath && status ? status.changes.map((change) => `${planningPath}/${change.path}`) : [];
  const committedText = status && (!status.isRepo ? 'this folder is not a git repository' : status.changes.length === 0 ? 'everything committed' : `${plural(status.changes.length, 'file', 'files')} not committed`);
  const areaName = (folder: string) => company.subdomains.find((area) => folder.endsWith(`/areas/${areaFolder(area)}`))?.name ?? folder.split('/').filter(Boolean).at(-1) ?? folder;

  return (
    <main className="page documents-page">
      <header className="today-head">
        <h2>Documents</h2>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setOpened(await api.openClientInEditor(company.id));
            })
          }
        >
          <FolderOpen size={15} />
          {editorName ? `Open everything in ${editorName}` : 'Open everything in your editor'}
        </button>
      </header>
      <p className="hint">{opened ? `Opened in ${opened}. What you change there shows here when you come back.` : 'Look at files here. To edit them, open them in your editor, with the repositories, planning, knowledge, LLM config and guides in one window.'}</p>

      {planning ? (
        <p className="documents-status">
          <span>
            Planning repository{status?.branch ? ` on ${status.branch}` : ''}
            {committedText ? `: ${committedText}` : ''}
          </span>
          <button className="quiet" onClick={() => void run(() => api.openInEditor(company.id, planning.path))}>
            <ExternalLink size={14} />
            Open in editor
          </button>
        </p>
      ) : (
        <p className="panel-blocked">
          <span>Planning stays private on this computer, with no git. Choose or create a repository to keep specs and decisions in git.</span>
          <button className="quiet" onClick={() => onOpenClient(company.id)}>
            Set up client
          </button>
        </p>
      )}

      <div className="task-tabs-row">
        <div className="task-tabs" role="tablist" aria-label="Document types">
          {SECTIONS.map((item) => (
            <button
              key={item.scope}
              role="tab"
              className="task-tab"
              aria-selected={scope === item.scope}
              onClick={() => {
                setScope(item.scope);
                setSelected(null);
              }}
            >
              {item.title}
              <span className="board-count">{files.filter((file) => file.scope === item.scope).length}</span>
            </button>
          ))}
        </div>
        <form className="documents-new" onSubmit={create}>
          <input aria-label="New document name" placeholder="New document name" value={name} onChange={(event) => setName(event.target.value)} />
          <select aria-label="Where to save it" value={where} onChange={(event) => setWhere(event.target.value)}>
            {planning?.places.map((place) => (
              <option key={place.folder} value={place.folder}>
                {place.name} (repository)
              </option>
            ))}
            <option value=".">{planning ? 'Top of the repository' : 'Planning (private, never in git)'}</option>
            <option value="knowledge">Knowledge (private, never in git)</option>
            {company.subdomains.map((area) => (
              <option key={area.id} value={`area:${area.id}`}>
                {area.name} (area, private, never in git)
              </option>
            ))}
          </select>
          <button className="quiet" disabled={busy || !name.trim()}>
            <FilePlus size={15} />
            New document
          </button>
        </form>
      </div>
      {(error || filesError) && <p className="error">{error || filesError}</p>}

      <div className="doc-explorer">
        <aside className="doc-explorer-tree">
          {shown.length === 0 ? <p className="hint">No files here yet.</p> : <FileTree nodes={buildFileTree(shown, scope === 'areas' ? areaName : undefined)} selectedPath={selected?.path ?? null} changedPaths={changed} onSelect={setSelected} />}
        </aside>
        {selected ? (
          <DocumentPreview key={selected.path} companyId={company.id} file={selected} freshness={freshness} editorName={editorName} onOpenTask={onOpenTask} />
        ) : (
          <div className="doc-preview-empty">
            <p className="hint">{sectionHint}</p>
            <p className="hint">Choose a file on the left to see it here.</p>
          </div>
        )}
      </div>
    </main>
  );
}
