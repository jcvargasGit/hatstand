import { Columns3, Inbox, List, Plus, RefreshCw } from 'lucide-react';
import type { Snapshot } from '../../../shared/api';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { plural } from '../lib/text';
import { groupToday, ideaCount, type TodayItem } from '../lib/today';
import { ReadinessBadge } from './ReadinessBadge';
import { TaskBoard } from './TaskBoard';
import { TaskTable } from './TaskTable';

type TodayPageProps = {
  snapshot: Snapshot;
  companyId: string | null;
  onSelectTask: (taskId: string) => void;
  onOpenClient: (companyId: string) => void;
  onOpenInbox: (companyId: string | null) => void;
  onOpenClosed: (companyId: string) => void;
  onNewTask: () => void;
  onChanged: () => Promise<void>;
};

export function TodayPage({ snapshot, companyId, onSelectTask, onOpenClient, onOpenInbox, onOpenClosed, onNewTask, onChanged }: TodayPageProps) {
  const groups = groupToday(snapshot, companyId);
  const company = snapshot.companies.find((item) => item.id === companyId);
  const layout = snapshot.todayLayout;
  const refreshing = useAction();
  const ideas = ideaCount(snapshot, companyId);
  const isEmpty = groups.waiting.length + groups.working.length + groups.next.length === 0;

  const section = (title: string, items: TodayItem[]) =>
    items.length > 0 && (
      <section className="today-group">
        <h2>{title}</h2>
        <TaskTable items={items} showClient={!companyId} onSelect={onSelectTask} />
      </section>
    );

  return (
    <main className="today">
      <header className={company ? 'today-head tasks-head' : 'today-head'}>
        {!company && <h1>Today</h1>}
        <div className="today-actions">
          <span className="hint">View as</span>
          <div className="layout-switch" role="group" aria-label="View tasks as">
            <button className="quiet" aria-pressed={layout === 'list'} onClick={() => void api.setTodayLayout('list')}>
              <List size={14} />
              List
            </button>
            <button className="quiet" aria-pressed={layout === 'board'} onClick={() => void api.setTodayLayout('board')}>
              <Columns3 size={14} />
              Board
            </button>
          </div>
          {layout === 'board' && (
            <button
              className="quiet"
              disabled={refreshing.busy}
              aria-label="Refresh pull requests"
              title="Refresh pull requests"
              onClick={() => void refreshing.run(() => api.refreshReviews())}
            >
              <RefreshCw size={14} />
            </button>
          )}
          <button onClick={onNewTask}>
            <Plus size={15} />
            New task
          </button>
        </div>
      </header>
      {company && <ReadinessBadge snapshot={snapshot} company={company} onOpen={() => onOpenClient(company.id)} />}
      {!company && ideas > 0 && (
        <button className="inbox-reminder" onClick={() => onOpenInbox(companyId)}>
          <Inbox size={15} />
          {plural(ideas, 'item', 'items')} in your inbox to review
        </button>
      )}
      {refreshing.error && <p className="error">{refreshing.error}</p>}
      {layout === 'board' ? (
        <TaskBoard snapshot={snapshot} companyId={companyId} onSelectTask={onSelectTask} onOpenClosed={onOpenClosed} onChanged={onChanged} />
      ) : isEmpty ? (
        <p className="empty">Nothing open here. Use New task above, or import your assigned work from the client settings.</p>
      ) : (
        <div className="today-scroll">
          {section('Waiting for you', groups.waiting)}
          {section('Working', groups.working)}
          {section('Up next', groups.next)}
        </div>
      )}
    </main>
  );
}
