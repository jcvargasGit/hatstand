import type { Snapshot } from '../../../shared/api';
import type { Company, Task } from '../../../shared/schemas';
import { DEFAULT_WORK_PERIOD, localDateKey, periodLabel, periodOf } from '../../../shared/work-periods';
import { closedAt } from './today';

export type ClosedGroup = { key: string; label: string; current: boolean; tasks: Task[] };

export function closedGroups(snapshot: Snapshot, company: Company, now = new Date()): ClosedGroup[] {
  const period = company.workPeriod ?? DEFAULT_WORK_PERIOD;
  const today = periodOf(period, localDateKey(now)).start;
  const closed = snapshot.tasks
    .filter((task) => task.companyId === company.id && task.status === 'done' && !task.archivedAt)
    .sort((a, b) => closedAt(b).localeCompare(closedAt(a)));
  const groups = new Map<string, ClosedGroup>();
  for (const task of closed) {
    const range = periodOf(period, localDateKey(closedAt(task)));
    const group = groups.get(range.start) ?? { key: range.start, label: periodLabel(range), current: range.start === today, tasks: [] };
    groups.set(range.start, { ...group, tasks: [...group.tasks, task] });
  }
  return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key));
}

export function descriptionSummary(description: string): string {
  return (
    description
      .split('\n')
      .map((line) => line.replace(/^\s*(#+|[-*+>]|\d+\.)\s+/, '').trim())
      .find(Boolean) ?? ''
  );
}
