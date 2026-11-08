import type { TrackerSyncReport } from '../../shared/api';
import type { Task } from '../../shared/schemas';
import type { Store } from '../store';
import { trackers, type Fetcher, type TrackerIssue } from './index';

export type SyncPlan = {
  create: TrackerIssue[];
  refresh: { task: Task; issue: TrackerIssue }[];
};

export function planSync(existing: Task[], issues: TrackerIssue[]): SyncPlan {
  const byKey = new Map(existing.flatMap((task) => (task.source ? [[task.source.key, task] as const] : [])));
  return {
    create: issues.filter((issue) => !byKey.has(issue.source.key)),
    refresh: issues.flatMap((issue) => {
      const task = byKey.get(issue.source.key);
      return task && !task.customTitle && task.title !== issue.title ? [{ task, issue }] : [];
    }),
  };
}

export async function syncTrackers(
  store: Store,
  companyId: string,
  secrets: Record<string, string>,
  fetcher: Fetcher = fetch,
): Promise<TrackerSyncReport> {
  const report: TrackerSyncReport = { added: 0, updated: 0, checked: [], errors: [] };
  for (const tracker of trackers.filter((item) => item.isConfigured(secrets))) {
    report.checked.push(tracker.name);
    try {
      const issues = await tracker.listAssigned(secrets, fetcher);
      const plan = planSync(store.listTasks(companyId), issues);
      for (const issue of plan.create) {
        store.createTask({ companyId, title: issue.title, description: issue.description }, issue.source);
        report.added += 1;
      }
      for (const { task, issue } of plan.refresh) {
        store.updateTask(task.id, { title: issue.title });
        report.updated += 1;
      }
    } catch (error) {
      report.errors.push(`${tracker.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return report;
}
