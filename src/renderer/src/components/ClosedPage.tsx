import type { Snapshot } from '../../../shared/api';
import type { Company, Task, WorkPeriod } from '../../../shared/schemas';
import { DEFAULT_WORK_PERIOD } from '../../../shared/work-periods';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { closedGroups } from '../lib/closed-tasks';
import { plural } from '../lib/text';
import { ClosedTable } from './ClosedTable';
import { WorkPeriodForm } from './WorkPeriodForm';

type ClosedPageProps = {
  snapshot: Snapshot;
  company: Company;
  onOpenTask: (taskId: string) => void;
  onChanged: () => Promise<void>;
};

export function ClosedPage({ snapshot, company, onOpenTask, onChanged }: ClosedPageProps) {
  const { error, busy, run } = useAction();
  const groups = closedGroups(snapshot, company);
  const areaName = (task: Task) => company.subdomains.find((area) => area.id === task.subdomainId)?.name ?? '';

  const savePeriod = (workPeriod: WorkPeriod) =>
    run(async () => {
      await api.saveCompany({ ...company, workPeriod });
      await onChanged();
    });

  return (
    <main className="page closed-page">
      <h2>Closed tasks</h2>
      <p className="hint">What was finished for this client, by work period. The board shows only the current period.</p>
      <WorkPeriodForm period={company.workPeriod ?? DEFAULT_WORK_PERIOD} busy={busy} onSave={(period) => void savePeriod(period)} />
      {error && <p className="error">{error}</p>}
      {groups.length === 0 && <p className="empty">Nothing closed yet. Tasks appear here when you mark them done.</p>}
      {groups.map((group) => (
        <section key={group.key} className="closed-period" aria-label={group.label}>
          <h3>
            {group.label}
            {group.current && <span className="closed-current">Current</span>}
            <span className="hint">{plural(group.tasks.length, 'task', 'tasks')}</span>
          </h3>
          <ClosedTable tasks={group.tasks} areaName={areaName} onOpenTask={onOpenTask} />
        </section>
      ))}
    </main>
  );
}
