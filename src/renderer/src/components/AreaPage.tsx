import { ArrowLeft, FilePlus, FolderOpen, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { Snapshot } from '../../../shared/api';
import type { Company, Subdomain } from '../../../shared/schemas';
import { workRepositories } from '../../../shared/work-repos';
import { useAction } from '../hooks/useAction';
import { useEditorName } from '../hooks/useEditorName';
import { api } from '../lib/api';
import { AREA_LINK_SUGGESTIONS } from '../lib/link-suggestions';
import { taskStateText } from '../lib/today';
import { ClientFiles } from './ClientFiles';
import { LinksEditor } from './LinksEditor';
import { MarkdownField } from './MarkdownField';
import { RepoPicker } from './RepoPicker';
import { TaskNumber } from './TaskNumber';
import { areaFolder, defaultArea, isDefaultArea } from '../../../shared/areas';

type AreaPageProps = {
  snapshot: Snapshot;
  company: Company;
  area: Subdomain;
  onChanged: () => Promise<void>;
  onBack: () => void;
  onNewTask: () => void;
  onOpenTask: (taskId: string) => Promise<void>;
};

type AreaTab = 'documents' | 'tasks' | 'links' | 'settings';

export function AreaPage({ snapshot, company, area, onChanged, onBack, onNewTask, onOpenTask }: AreaPageProps) {
  const [tab, setTab] = useState<AreaTab>('documents');
  const [name, setName] = useState(area.name);
  const [description, setDescription] = useState(area.description);
  const [documentName, setDocumentName] = useState('');
  const [created, setCreated] = useState(0);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { error, busy, run } = useAction();
  const editorName = useEditorName();
  const tasks = snapshot.tasks.filter((task) => task.subdomainId === area.id && task.status !== 'idea' && !task.archivedAt);
  const wholeRepos = workRepositories(company).filter((repo) => !repo.splitByFolder);
  const tabs: { id: AreaTab; label: string; count?: number }[] = [
    { id: 'documents', label: 'Documents' },
    { id: 'tasks', label: 'Tasks', count: tasks.length },
    { id: 'links', label: 'Links', count: area.links.length },
    { id: 'settings', label: 'Settings' },
  ];

  const saveCompany = (next: Company) =>
    run(async () => {
      await api.saveCompany(next);
      await onChanged();
    });
  const saveArea = (change: Partial<Subdomain>) =>
    saveCompany({ ...company, subdomains: company.subdomains.map((item) => (item.id === area.id ? { ...item, ...change } : item)) });
  const saveRepositories = (repoIds: string[]) =>
    saveCompany({
      ...company,
      projects: company.projects.map((repo) => {
        if (repoIds.includes(repo.id)) return { ...repo, subdomainId: area.id };
        return repo.subdomainId === area.id ? { ...repo, subdomainId: undefined } : repo;
      }),
    });

  const createDocument = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const path = await api.createDocument(company.id, `area:${area.id}`, documentName);
      setDocumentName('');
      setCreated((count) => count + 1);
      setOpenPath(path);
    });
  };

  return (
    <main className="page documents-page area-page">
      <header className="today-head">
        <div className="area-title">
          <button className="quiet" onClick={onBack}>
            <ArrowLeft size={15} />
            All areas
          </button>
          <h2>{area.name}</h2>
        </div>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await api.openAreaInEditor(company.id, area.id);
              setOpened(true);
            })
          }
        >
          <FolderOpen size={15} />
          {editorName ? `Open area in ${editorName}` : 'Open area in your editor'}
        </button>
      </header>
      <p className="hint">{opened ? `Opened${editorName ? ` in ${editorName}` : ''}. What you change there shows here when you come back.` : area.description || 'Private to you, outside every repository. Agents read these files in the tasks of this area.'}</p>

      <div className="task-tabs-row">
        <div className="task-tabs" role="tablist" aria-label={`${area.name} sections`}>
          {tabs.map((item) => (
            <button key={item.id} role="tab" className="task-tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>
              {item.label}
              {item.count !== undefined && <span className="board-count">{item.count}</span>}
            </button>
          ))}
        </div>
        {tab === 'documents' && (
          <form className="documents-new" onSubmit={createDocument}>
            <input aria-label="New document name" placeholder="New document name" value={documentName} onChange={(event) => setDocumentName(event.target.value)} />
            <button className="quiet" disabled={busy || !documentName.trim()}>
              <FilePlus size={15} />
              New document
            </button>
          </form>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      {tab === 'documents' && (
        <ClientFiles
          companyId={company.id}
          scope="areas"
          onlyFolder={`/areas/${areaFolder(area)}`}
          bare
          refreshKey={`${area.id}:${created}`}
          openPath={openPath}
          onOpened={() => setOpenPath(null)}
          onOpenTask={onOpenTask}
        />
      )}

      {tab === 'tasks' && (
        <section className="overview-card" aria-label="Tasks of this area">
          <div className="overview-head">
            <h3>Tasks</h3>
            <button className="quiet" onClick={onNewTask}>
              <Plus size={14} />
              New task
            </button>
          </div>
          {tasks.length === 0 ? (
            <p className="hint">No tasks in this area yet.</p>
          ) : (
            <ul className="client-project-list">
              {tasks.map((task) => (
                <li key={task.id}>
                  <button type="button" className="client-project-open" onClick={() => void onOpenTask(task.id)}>
                    <span>
                      <TaskNumber task={task} />
                      {task.title}
                    </span>
                  </button>
                  <span className="hint">{taskStateText({ task, company, session: undefined, pulls: [] })}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'links' && (
        <section className="overview-card" aria-label="Links of this area">
          <p className="hint">Agents get these links, along with the ones of the client, in the tasks of this area.</p>
          <LinksEditor links={area.links} suggestions={AREA_LINK_SUGGESTIONS} onChange={(links) => void saveArea({ links })} />
        </section>
      )}

      {tab === 'settings' && (
        <div className="area-settings">
          <section className="overview-card" aria-label="About this area">
            <label className="stacked-field">
              Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => {
                  if (name.trim() && name !== area.name) void saveArea({ name: name.trim() });
                }}
              />
            </label>
            <div className="stacked-field">
              <span>What this area is</span>
              <MarkdownField
                label="What this area is"
                value={description}
                onChange={setDescription}
                onCommit={(text) => {
                  if (text !== area.description) void saveArea({ description: text });
                }}
              />
            </div>
          </section>
          {wholeRepos.length > 0 && (
            <section className="overview-card" aria-label="Repositories of this area">
              <RepoPicker
                company={{ ...company, projects: wholeRepos, subdomains: [] }}
                selected={wholeRepos.filter((repo) => repo.subdomainId === area.id).map((repo) => repo.id)}
                hint="New tasks in this area start with these repositories selected. A repository belongs to one area, so choosing it here moves it from any other."
                onChange={(repoIds) => void saveRepositories(repoIds)}
              />
              {area.folders.length > 0 && <p className="hint">This area also owns {area.folders.map((folder) => folder.path).join(', ')}. Change folders of a repository in the Areas step of Client settings.</p>}
            </section>
          )}
          <section className="overview-card" aria-label="Delete this area">
            {isDefaultArea(company, area.id) ? (
              <p className="hint">This is the default area of {company.name}. Tasks that belong to no other area live here, so it cannot be deleted.</p>
            ) : confirming ? (
              <div className="inline-form">
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api.deleteArea(company.id, area.id);
                      await onChanged();
                      onBack();
                    })
                  }
                >
                  Delete area and its files
                </button>
                <button className="quiet" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button className="quiet" onClick={() => setConfirming(true)}>
                <Trash2 size={15} />
                Delete area
              </button>
            )}
            {!isDefaultArea(company, area.id) && <p className="hint">Deletes its documents and links. Its tasks move to {defaultArea(company)?.name ?? 'the default area'}, and its repositories stay without an area.</p>}
          </section>
        </div>
      )}
    </main>
  );
}
