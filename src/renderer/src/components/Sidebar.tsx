import { ChevronDown, ChevronRight, FileText, House, Inbox, Layers, ListChecks, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, Sun } from 'lucide-react';
import { shownAreaName } from '../../../shared/areas';
import { useState, type ReactNode } from 'react';
import type { Snapshot } from '../../../shared/api';
import type { Company } from '../../../shared/schemas';
import type { View } from '../App';
import type { SidebarLayout } from '../hooks/useSidebarLayout';
import { useStayAwake } from '../hooks/useStayAwake';
import { api } from '../lib/api';
import { moveClient } from '../lib/client-order';
import { shortcutLabel } from '../lib/shortcuts';
import { taskTypeOf } from '../../../shared/task-types';
import { clientTree, ideaCount, waitingByClient, waitingCount, type TodayItem, stepProgress } from '../lib/today';
import { ClientAvatar } from './ClientAvatar';
import { ReleaseControl } from './ReleaseControl';
import { TaskNumber } from './TaskNumber';
import { TaskStateIcon } from './TaskStateIcon';
import { TaskTypeTag } from './TaskTypeTag';

const TASKS_SHOWN = 8;

type SidebarProps = {
  snapshot: Snapshot;
  view: View;
  selectedTaskId: string | null;
  layout: SidebarLayout;
  onNavigate: (view: View) => void;
  onSelectTask: (item: TodayItem) => void;
  onOpenSearch: () => void;
};

type TaskLinkProps = {
  item: TodayItem;
  selected: boolean;
  showClient?: boolean;
  onSelect: () => void;
};

function TaskLink({ item, selected, showClient = false, onSelect }: TaskLinkProps) {
  const detail = [showClient ? item.company.name : shownAreaName(item.company, item.task.subdomainId), stepProgress(item.task)].filter(Boolean).join(', ');
  const type = taskTypeOf(item.task, item.company);
  return (
    <button className="tree-task" title={item.task.title} aria-current={selected ? 'true' : undefined} onClick={onSelect}>
      <TaskStateIcon item={item} size={15} />
      <span className="tree-task-text">
        <span className="tree-task-title">
          <TaskNumber task={item.task} />
          {item.task.title}
        </span>
        {(type || detail) && (
          <small>
            {type && <TaskTypeTag type={type} guideName={item.task.guide?.name} />}
            {type && detail ? `, ${detail}` : detail}
          </small>
        )}
        {item.session?.state === 'needs-input' && <small className="tree-task-ask">Needs your answer</small>}
      </span>
    </button>
  );
}

type TreeMenuRowProps = {
  icon: ReactNode;
  label: string;
  client: string;
  count: number;
  current: boolean;
  onSelect: () => void;
};

function TreeMenuRow({ icon, label, client, count, current, onSelect }: TreeMenuRowProps) {
  return (
    <button className="tree-menu-row" aria-label={`${label} of ${client}`} aria-current={current ? 'page' : undefined} onClick={onSelect}>
      {icon}
      <span>{label}</span>
      {count > 0 && <span className="board-count">{count}</span>}
    </button>
  );
}

export function Sidebar({ snapshot, view, selectedTaskId, layout, onNavigate, onSelectTask, onOpenSearch }: SidebarProps) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState<string[]>([]);
  const [showFinished, setShowFinished] = useState<string[]>([]);
  const activeId = view.kind === 'today' && !selectedTaskId ? view.companyId : null;
  const todayActive = view.kind === 'today' && view.companyId === null && !selectedTaskId;
  const searching = query.trim() !== '';
  const waitingGroups = waitingByClient(snapshot);
  const waitingTotal = waitingGroups.reduce((total, group) => total + group.items.length, 0);
  const ideas = ideaCount(snapshot, null);

  const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  const openClient = (company: Company) => onNavigate({ kind: 'today', companyId: company.id });
  const awake = useStayAwake().status?.active;
  const [dragging, setDragging] = useState<string | null>(null);
  const clientIds = snapshot.companies.map((company) => company.id);
  const dropOn = (target: string) => {
    if (dragging) void api.setClientOrder(moveClient(clientIds, dragging, target));
    setDragging(null);
  };
  const nudge = (id: string, offset: number) => {
    const target = clientIds[clientIds.indexOf(id) + offset];
    if (target) void api.setClientOrder(moveClient(clientIds, id, target));
  };

  if (layout.collapsed) {
    return (
      <nav className="sidebar is-collapsed" aria-label="Main">
        <button className="rail-button" aria-label="Show sidebar" title="Show sidebar" onClick={layout.toggleCollapsed}>
          <PanelLeftOpen size={18} />
        </button>
        <button className="rail-button" aria-label="Today" title="Today" onClick={() => onNavigate({ kind: 'today', companyId: null })}>
          <House size={18} />
        </button>
        <button className="rail-button" aria-label="Search everything" title={`Search everything ${shortcutLabel('K')}`} onClick={onOpenSearch}>
          <Search size={18} />
        </button>
        <button className="rail-button" aria-label="Backlog" title={`Backlog ${shortcutLabel('I')}`} onClick={() => onNavigate({ kind: 'inbox', companyId: null })}>
          <Inbox size={18} />
          {ideas > 0 && <span className="rail-count">{ideas}</span>}
        </button>
        {snapshot.companies.map((company) => {
          const count = waitingCount(snapshot, company.id);
          return (
            <button
              key={company.id}
              className="rail-button"
              aria-label={company.name}
              title={company.name}
              onClick={() => {
                layout.toggleCollapsed();
                layout.openClient(company.id);
                openClient(company);
              }}
            >
              <ClientAvatar company={company} size="small" />
              {count > 0 && <span className="rail-count">{count}</span>}
            </button>
          );
        })}
        <div className="sidebar-end">
          <button className="rail-button" aria-label="Settings" title="Settings" onClick={() => onNavigate({ kind: 'settings' })}>
            <Settings size={18} />
          </button>
        </div>
      </nav>
    );
  }

  return (
    <nav className="sidebar" aria-label="Main">
      <div className="sidebar-top">
        <label className="sidebar-search">
          <Search size={15} />
          <input aria-label="Filter tasks" placeholder="Filter tasks" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button className="rail-button" aria-label="Hide sidebar" title="Hide sidebar" onClick={layout.toggleCollapsed}>
          <PanelLeftClose size={18} />
        </button>
      </div>
      <button className="new-task-button" aria-current={view.kind === 'new-task' ? 'page' : undefined} onClick={() => onNavigate({ kind: 'new-task', companyId: null })}>
        <Plus size={16} />
        New task
      </button>

      <div className="sidebar-scroll">
        <button className="nav-row" aria-current={todayActive ? 'page' : undefined} onClick={() => onNavigate({ kind: 'today', companyId: null })}>
          <House size={16} />
          <span className="nav-name">Today</span>
        </button>
        <button className="nav-row" onClick={onOpenSearch}>
          <Search size={16} />
          <span className="nav-name">Search everything</span>
          <kbd>{shortcutLabel('K')}</kbd>
        </button>
        <button className="nav-row" aria-current={view.kind === 'inbox' && view.companyId === null ? 'page' : undefined} onClick={() => onNavigate({ kind: 'inbox', companyId: null })}>
          <Inbox size={16} />
          <span className="nav-name">Backlog</span>
          {ideas > 0 && (
            <span className="nav-count" aria-label={`${ideas} in your backlog`}>
              {ideas}
            </span>
          )}
        </button>

        {!searching && waitingTotal > 0 && (
          <section aria-label="Needs you">
            <h2 className="nav-heading nav-heading-toggle">
              <button aria-expanded={!layout.needsYouHidden} title={layout.needsYouHidden ? 'Show this list' : 'Hide this list'} onClick={layout.toggleNeedsYou}>
                {layout.needsYouHidden ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                Needs you
                <span className="nav-count" aria-label={`${waitingTotal} waiting for you`}>
                  {waitingTotal}
                </span>
              </button>
            </h2>
            {!layout.needsYouHidden &&
              waitingGroups.map(({ company, items }) => (
                <div key={company.id} role="group" aria-label={company.name}>
                  <h3 className="needs-you-client">
                    <ClientAvatar company={company} size="small" />
                    <span className="nav-name">{company.name}</span>
                  </h3>
                  {items.map((item) => (
                    <TaskLink
                      key={item.task.id}
                      item={item}
                      selected={item.task.id === selectedTaskId}
                      onSelect={() => onSelectTask(item)}
                    />
                  ))}
                </div>
              ))}
          </section>
        )}

        <h2 className="nav-heading">Clients</h2>
        {clientTree(snapshot, query).map(({ company, active, finished }) => {
          const isOpen = searching || !layout.closedClients.includes(company.id);
          const count = waitingCount(snapshot, company.id);
          const visible = showAll.includes(company.id) || searching ? active : active.slice(0, TASKS_SHOWN);
          const finishedOpen = searching || showFinished.includes(company.id);
          return (
            <section key={company.id} className="tree-client" aria-label={`${company.name} tasks`}>
              <div
                className={`tree-client-row${dragging === company.id ? ' is-dragging' : ''}`}
                aria-current={activeId === company.id && !isOpen ? 'page' : undefined}
                draggable={!searching}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  setDragging(company.id);
                }}
                onDragEnd={() => setDragging(null)}
                onDragOver={(event) => {
                  if (dragging) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  dropOn(company.id);
                }}
              >
                <button
                  className="tree-toggle"
                  aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${company.name}`}
                  aria-expanded={isOpen}
                  onClick={() => layout.toggleClient(company.id)}
                >
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <button
                  className="tree-client-name"
                  title="Drag to reorder, or press Alt with the up and down arrows"
                  onClick={() => openClient(company)}
                  onKeyDown={(event) => {
                    if (!event.altKey || searching || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
                    event.preventDefault();
                    nudge(company.id, event.key === 'ArrowUp' ? -1 : 1);
                  }}
                >
                  <ClientAvatar company={company} size="small" />
                  <span className="nav-name">{company.name}</span>
                  {count > 0 && (
                    <span className="nav-count" aria-label={`${count} waiting for you`}>
                      {count}
                    </span>
                  )}
                </button>
                <button
                  className="tree-action"
                  aria-label={`Documents for ${company.name}`}
                  title="Documents"
                  onClick={() => onNavigate({ kind: 'documents', companyId: company.id })}
                >
                  <FileText size={14} />
                </button>
                <button
                  className="tree-action"
                  aria-label={`Settings for ${company.name}`}
                  title="Client settings"
                  onClick={() => onNavigate({ kind: 'setup', companyId: company.id })}
                >
                  <Settings size={14} />
                </button>
              </div>
              {isOpen && (
                <div className="tree-tasks">
                  {!searching && (
                    <>
                      <TreeMenuRow
                        icon={<Inbox size={14} />}
                        label="Backlog"
                        client={company.name}
                        count={ideaCount(snapshot, company.id)}
                        current={view.kind === 'inbox' && view.companyId === company.id}
                        onSelect={() => onNavigate({ kind: 'inbox', companyId: company.id })}
                      />
                      <TreeMenuRow
                        icon={<Layers size={14} />}
                        label="Areas"
                        client={company.name}
                        count={company.subdomains.length}
                        current={(view.kind === 'hub' || view.kind === 'area') && view.companyId === company.id}
                        onSelect={() => onNavigate({ kind: 'hub', companyId: company.id })}
                      />
                      <div className="tree-menu-line">
                        <TreeMenuRow
                          icon={<ListChecks size={14} />}
                          label="Tasks"
                          client={company.name}
                          count={active.length}
                          current={activeId === company.id}
                          onSelect={() => openClient(company)}
                        />
                        <button
                          className="tree-add-task"
                          aria-label={`New task for ${company.name}`}
                          title="New task"
                          onClick={() => onNavigate({ kind: 'new-task', companyId: company.id })}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </>
                  )}
                  <div className={searching ? undefined : 'tree-task-list'}>
                  {visible.map((item) => (
                    <TaskLink
                      key={item.task.id}
                      item={item}
                      selected={item.task.id === selectedTaskId}
                      onSelect={() => onSelectTask(item)}
                    />
                  ))}
                  {active.length > visible.length && (
                    <button className="tree-more" onClick={() => setShowAll(toggleIn(showAll, company.id))}>
                      Show {active.length - visible.length} more
                    </button>
                  )}
                  {finished.length > 0 && (
                    <>
                      <button
                        className="tree-more"
                        aria-expanded={finishedOpen}
                        onClick={() => setShowFinished(toggleIn(showFinished, company.id))}
                      >
                        {finishedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        Done and archived ({finished.length})
                      </button>
                      {finishedOpen &&
                        finished.map((item) => (
                          <TaskLink
                            key={item.task.id}
                            item={item}
                            selected={item.task.id === selectedTaskId}
                            onSelect={() => onSelectTask(item)}
                          />
                        ))}
                    </>
                  )}
                  </div>
                </div>
              )}
            </section>
          );
        })}
        <button className="nav-row nav-add" aria-current={view.kind === 'new-client' ? 'page' : undefined} onClick={() => onNavigate({ kind: 'new-client' })}>
          <Plus size={16} />
          <span className="nav-name">Add client</span>
        </button>
      </div>

      <div className="sidebar-end">
        {awake && (
          <button className="nav-row nav-awake" onClick={() => onNavigate({ kind: 'settings' })}>
            <Sun size={16} />
            <span className="nav-name">Keeping this computer awake</span>
          </button>
        )}
        <ReleaseControl />
        <button className="nav-row" aria-current={view.kind === 'settings' ? 'page' : undefined} onClick={() => onNavigate({ kind: 'settings' })}>
          <Settings size={16} />
          <span className="nav-name">Settings</span>
        </button>
      </div>
    </nav>
  );
}
