import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { SearchResult } from '../../shared/api';
import { CommandPalette, type PaletteCommand } from './components/CommandPalette';
import { DocumentsPage } from './components/DocumentsPage';
import { ClientHubPage } from './components/ClientHubPage';
import { ClosedPage } from './components/ClosedPage';
import { AreaPage } from './components/AreaPage';
import { InboxPage } from './components/InboxPage';
import { NewClientForm } from './components/NewClientForm';
import { NewTaskPage } from './components/NewTaskPage';
import { SettingsPage } from './components/SettingsPage';
import { SetupWizard } from './components/SetupWizard';
import { Sidebar } from './components/Sidebar';
import { TaskPanel } from './components/TaskPanel';
import { TodayPage } from './components/TodayPage';
import { useShortcuts } from './hooks/useShortcuts';
import { useSidebarLayout } from './hooks/useSidebarLayout';
import { useSnapshot } from './hooks/useSnapshot';
import { api } from './lib/api';
import { shortcutLabel } from './lib/shortcuts';
import { inkOn, NEUTRAL_TINT, ideaCount, nextWaiting } from './lib/today';
import { ClientTabs, type ClientTab } from './components/ClientTabs';

export type View =
  | { kind: 'today'; companyId: string | null }
  | { kind: 'setup'; companyId: string }
  | { kind: 'documents'; companyId: string; path?: string }
  | { kind: 'closed'; companyId: string }
  | { kind: 'inbox'; companyId: string | null }
  | { kind: 'hub'; companyId: string }
  | { kind: 'area'; companyId: string; areaId: string }
  | { kind: 'settings' }
  | { kind: 'new-task'; companyId: string | null; areaId?: string }
  | { kind: 'new-client' };

const SECTION_VIEWS = new Set<View['kind']>(['today', 'setup', 'documents', 'closed', 'inbox', 'hub', 'area']);

function clientTabOf(view: View, hasTask: boolean): ClientTab | null {
  if (!('companyId' in view) || !view.companyId) return null;
  if (view.kind === 'today') return hasTask ? null : 'tasks';
  if (view.kind === 'inbox') return 'inbox';
  if (view.kind === 'closed') return 'closed';
  if (view.kind === 'hub' || view.kind === 'area') return 'hub';
  if (view.kind === 'documents') return 'documents';
  return view.kind === 'setup' ? 'setup' : null;
}

function clientTabView(tab: ClientTab, companyId: string): View {
  if (tab === 'tasks') return { kind: 'today', companyId };
  return { kind: tab, companyId };
}

export function App() {
  const { snapshot, refresh } = useSnapshot();
  const layout = useSidebarLayout();
  const [view, setView] = useState<View>({ kind: 'today', companyId: null });
  const [taskId, setTaskId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const task = view.kind === 'today' ? snapshot?.tasks.find((item) => item.id === taskId) : undefined;
  const viewCompanyId = 'companyId' in view ? view.companyId : null;
  const tintId = task ? task.companyId : viewCompanyId;
  const viewCompany = snapshot?.companies.find((item) => item.id === viewCompanyId);
  const viewArea = view.kind === 'area' ? viewCompany?.subdomains.find((item) => item.id === view.areaId) : undefined;
  const tint = snapshot?.companies.find((item) => item.id === tintId)?.color ?? NEUTRAL_TINT;

  const activeCount = snapshot?.companies.filter((company) => !company.archivedAt).length;

  const navigate = (next: View) => {
    setTaskId(null);
    setView(next);
  };
  const openTask = (id: string, companyId: string | null) => {
    setTaskId(id);
    setView({ kind: 'today', companyId });
  };
  const openClientSettings = (companyId: string) => navigate({ kind: 'setup', companyId });

  const openNextWaiting = () => {
    const next = snapshot ? nextWaiting(snapshot, taskId) : undefined;
    if (next) openTask(next.task.id, next.company.id);
  };

  useShortcuts({
    k: () => setSearching((open) => !open),
    n: () => navigate({ kind: 'new-task', companyId: viewCompanyId }),
    ',': () => navigate({ kind: 'settings' }),
    j: openNextWaiting,
    i: () => navigate({ kind: 'inbox', companyId: viewCompanyId }),
  });

  const commands = useMemo<PaletteCommand[]>(
    () => [
      { id: 'new-task', title: 'New task', hint: shortcutLabel('N'), run: () => navigate({ kind: 'new-task', companyId: viewCompanyId }) },
      { id: 'next-waiting', title: 'Next task waiting for you', hint: shortcutLabel('J'), run: openNextWaiting },
      { id: 'inbox', title: 'Open backlog', hint: shortcutLabel('I'), run: () => navigate({ kind: 'inbox', companyId: viewCompanyId }) },
      { id: 'today', title: 'Go to Today', run: () => navigate({ kind: 'today', companyId: null }) },
      { id: 'settings', title: 'Open settings', hint: shortcutLabel(','), run: () => navigate({ kind: 'settings' }) },
      { id: 'awake-sessions', title: 'Stay awake while a session is running', run: () => void api.setStayAwake('sessions') },
      { id: 'awake-always', title: 'Stay awake while Hatstand is open', run: () => void api.setStayAwake('always') },
      { id: 'awake-off', title: 'Turn off stay awake', run: () => void api.setStayAwake('off') },
      ...(snapshot?.companies.filter((company) => !company.archivedAt) ?? []).flatMap((company) => [
        { id: `inbox-${company.id}`, title: `Backlog for ${company.name}`, run: () => navigate({ kind: 'inbox', companyId: company.id }) },
        { id: `closed-${company.id}`, title: `Closed tasks of ${company.name}`, run: () => navigate({ kind: 'closed', companyId: company.id }) },
        { id: `hub-${company.id}`, title: `Areas of ${company.name}`, run: () => navigate({ kind: 'hub', companyId: company.id }) },
        { id: `documents-${company.id}`, title: `Documents for ${company.name}`, run: () => navigate({ kind: 'documents', companyId: company.id }) },
        { id: `setup-${company.id}`, title: `Settings for ${company.name}`, run: () => openClientSettings(company.id) },
      ]),
    ],
    [snapshot, viewCompanyId, taskId],
  );

  const openSearchResult = (result: SearchResult) => {
    if (result.kind === 'task') {
      if (snapshot?.tasks.find((item) => item.id === result.taskId)?.status === 'idea') navigate({ kind: 'inbox', companyId: result.companyId });
      else openTask(result.taskId, result.companyId);
    }
    if (result.kind === 'client') navigate({ kind: 'today', companyId: result.companyId });
    if (result.kind === 'file') navigate({ kind: 'documents', companyId: result.companyId, path: result.path });
    if (result.kind === 'repo') void api.openInEditor(result.companyId, result.path);
  };

  useEffect(() => {
    if (activeCount === 0 && view.kind === 'today') setView({ kind: 'new-client' });
  }, [activeCount, view.kind]);

  if (!snapshot) return <main className="loading">Opening your clients</main>;

  const active = { ...snapshot, companies: snapshot.companies.filter((company) => !company.archivedAt) };
  const clientTab = clientTabOf(view, Boolean(task));

  return (
    <div className="shell" style={{ '--client': tint, '--ink-on-client': inkOn(tint) } as CSSProperties}>
      <Sidebar
        snapshot={active}
        view={view}
        selectedTaskId={task?.id ?? null}
        layout={layout}
        onNavigate={navigate}
        onSelectTask={(item) => openTask(item.task.id, item.company.id)}
        onOpenSearch={() => setSearching(true)}
      />
      {searching && <CommandPalette snapshot={active} commands={commands} onResult={openSearchResult} onClose={() => setSearching(false)} />}
      {SECTION_VIEWS.has(view.kind) && (
      <div className="client-view">
      {clientTab && viewCompany && (
        <ClientTabs
          company={viewCompany}
          active={clientTab}
          inboxCount={ideaCount(active, viewCompany.id)}
          onSelect={(tab) => navigate(clientTabView(tab, viewCompany.id))}
        />
      )}
      {view.kind === 'today' &&
        (task ? (
          <TaskPanel key={task.id} snapshot={snapshot} task={task} onChanged={refresh} onOpenClient={openClientSettings} onSentBack={(companyId) => navigate({ kind: 'inbox', companyId })} />
        ) : (
          <TodayPage
            snapshot={active}
            companyId={view.companyId}
            onSelectTask={(id) => openTask(id, snapshot.tasks.find((item) => item.id === id)?.companyId ?? view.companyId)}
            onOpenClient={openClientSettings}
            onOpenInbox={(companyId) => navigate({ kind: 'inbox', companyId })}
            onOpenClosed={(companyId) => navigate({ kind: 'closed', companyId })}
            onNewTask={() => navigate({ kind: 'new-task', companyId: view.companyId })}
            onChanged={refresh}
          />
        ))}
      {view.kind === 'setup' && viewCompany && (
        <SetupWizard
          key={viewCompany.id}
          snapshot={snapshot}
          company={viewCompany}
          onChanged={refresh}
          onFinish={() => navigate({ kind: 'today', companyId: viewCompany.id })}
          onOpenArea={(areaId) => navigate({ kind: 'area', companyId: viewCompany.id, areaId })}
          onOpenTask={async (id) => {
            await refresh();
            openTask(id, viewCompany.id);
          }}
        />
      )}
      {view.kind === 'documents' && viewCompany && (
        <DocumentsPage
          key={viewCompany.id}
          snapshot={snapshot}
          company={viewCompany}
          initialPath={view.path}
          onOpenClient={openClientSettings}
          onOpenTask={async (id) => {
            await refresh();
            openTask(id, viewCompany.id);
          }}
        />
      )}
      {view.kind === 'closed' && viewCompany && <ClosedPage key={viewCompany.id} snapshot={active} company={viewCompany} onOpenTask={(id) => openTask(id, viewCompany.id)} onChanged={refresh} />}
      {view.kind === 'hub' && viewCompany && <ClientHubPage key={viewCompany.id} snapshot={active} company={viewCompany} onChanged={refresh} onOpenArea={(areaId) => navigate({ kind: 'area', companyId: viewCompany.id, areaId })} />}
      {view.kind === 'area' && viewCompany && viewArea && (
        <AreaPage
          key={viewArea.id}
          snapshot={snapshot}
          company={viewCompany}
          area={viewArea}
          onChanged={refresh}
          onBack={() => navigate({ kind: 'hub', companyId: viewCompany.id })}
          onNewTask={() => navigate({ kind: 'new-task', companyId: viewCompany.id, areaId: viewArea.id })}
          onOpenTask={async (id) => {
            await refresh();
            openTask(id, viewCompany.id);
          }}
        />
      )}
      {view.kind === 'inbox' && (
        <InboxPage key={view.companyId ?? 'all'} snapshot={active} companyId={view.companyId} onOpenTask={openTask} onChanged={refresh} />
      )}
      </div>
      )}
      {view.kind === 'settings' && (
        <SettingsPage
          snapshot={snapshot}
          onChanged={refresh}
          onOpenClient={openClientSettings}
          onAddClient={() => navigate({ kind: 'new-client' })}
        />
      )}
      {view.kind === 'new-task' && (
        <NewTaskPage
          key={`${view.companyId ?? 'any'}-${view.areaId ?? ''}`}
          snapshot={active}
          initialCompanyId={view.companyId}
          initialAreaId={view.areaId}
          onChanged={refresh}
          onCreated={async (id, companyId) => {
            await refresh();
            openTask(id, companyId);
          }}
        />
      )}
      {view.kind === 'new-client' && (
        <NewClientForm
          isFirst={snapshot.companies.length === 0}
          usedColors={snapshot.companies.map((company) => company.color)}
          onCreated={async (companyId) => {
            await refresh();
            navigate({ kind: 'setup', companyId });
          }}
        />
      )}
    </div>
  );
}
