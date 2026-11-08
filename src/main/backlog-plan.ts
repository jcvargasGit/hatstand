import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import type { BacklogPlanReport } from '../shared/api';
import { backlogPlanSchema, checkBacklogPlan, parsePlanText, planItemLabel, planItemsFrom, planText, type BacklogPlan, type PlanItem } from '../shared/backlog-plan';
import type { BacklogPlanLink, Task } from '../shared/schemas';
import type { DataPaths } from './paths';
import { writePrivateFile, type Store } from './store';

export type BacklogPromptInput = {
  planFile: string;
  items: Task[];
  schema: string;
};

const planDigest = (plan: BacklogPlan) => createHash('sha256').update(planText(plan)).digest('hex');

export const planItemsOf = (store: Store, task: Task): PlanItem[] => planItemsFrom(requireLink(task).items, store.listTasks(task.companyId));

function requireLink(task: Task): BacklogPlanLink {
  if (!task.backlogPlan) throw new Error('This task does not plan a backlog.');
  return task.backlogPlan;
}

export function createBacklogPlanTask(store: Store, companyId: string, taskIds: string[]): Task {
  const ids = [...new Set(taskIds)];
  if (ids.length === 0) throw new Error('Select at least one task for the assistant to review.');
  const inbox = store.listTasks(companyId);
  const items = ids.map((id) => {
    const item = inbox.find((candidate) => candidate.id === id);
    if (!item) throw new Error('A selected task is no longer in this client\'s inbox. Check your selection and try again.');
    if (item.status !== 'idea' || item.archivedAt) throw new Error(`"${item.title}" is no longer in the inbox. Check your selection and try again.`);
    if (item.number === undefined) throw new Error(`"${item.title}" has no task number yet. Reopen Hatstand and try again.`);
    return { ...item, number: item.number };
  });
  const title = `Plan the backlog: ${items.length === 1 ? '1 task' : `${items.length} tasks`}`;
  const description = [
    'The assistant proposes an implementation plan for these inbox tasks: the order, the dependencies, what cannot be developed at the same time, and what needs your decision first. It does not change code. Approving the plan records your review, and starts nothing.',
    '',
    ...items.map((item) => `- #${item.number} ${item.title}`),
  ].join('\n');
  const created = store.createTask({ companyId, title, description });
  store.updateTask(created.id, { type: 'planning' });
  return store.setBacklogPlan(created.id, { items: items.map(({ id, number }) => ({ id, number })) });
}

export function readPlanReport(store: Store, paths: DataPaths, task: Task): BacklogPlanReport {
  const link = requireLink(task);
  const file = paths.planFile(task.companyId, task.id);
  if (!existsSync(file)) return { state: 'missing' };
  const check = parsePlanText(readFileSync(file, 'utf8'), planItemsOf(store, task));
  if (!check.success) return { state: 'invalid', problems: check.problems };
  const approved = link.approval !== undefined && link.approval.digest === planDigest(check.plan);
  return {
    state: 'valid',
    plan: check.plan,
    approvedAt: approved ? (link.approval?.approvedAt ?? null) : null,
    changedAfterApproval: link.approval !== undefined && !approved,
  };
}

export function savePlan(store: Store, paths: DataPaths, taskId: string, raw: unknown): BacklogPlanReport {
  const task = store.findTask(taskId);
  const link = requireLink(task);
  const check = checkBacklogPlan(raw, planItemsOf(store, task));
  if (!check.success) throw new Error(`The plan was not saved. ${check.problems.join(' ')}`);
  writePrivateFile(paths.planFile(task.companyId, task.id), planText(check.plan));
  const saved = store.setBacklogPlan(task.id, { items: link.items });
  return readPlanReport(store, paths, saved);
}

export function setPlanApproval(store: Store, paths: DataPaths, taskId: string, approved: boolean): BacklogPlanReport {
  const task = store.findTask(taskId);
  const link = requireLink(task);
  if (!approved) return readPlanReport(store, paths, store.setBacklogPlan(task.id, { items: link.items }));
  const report = readPlanReport(store, paths, task);
  if (report.state === 'missing') throw new Error('There is no plan to approve yet.');
  if (report.state === 'invalid') throw new Error('Fix the plan before approving it.');
  const approval = { approvedAt: new Date().toISOString(), digest: planDigest(report.plan) };
  return readPlanReport(store, paths, store.setBacklogPlan(task.id, { items: link.items, approval }));
}

export function answerPlanCheck(store: Store, paths: DataPaths, taskId: string): { ok: boolean; text: string } {
  const task = store.findTask(taskId);
  const file = paths.planFile(task.companyId, task.id);
  if (!existsSync(file)) return { ok: false, text: `There is no plan yet. Write it to ${file}, then check it again.\n` };
  const items = planItemsOf(store, task);
  const check = parsePlanText(readFileSync(file, 'utf8'), items);
  if (!check.success) return { ok: false, text: `The plan is not valid yet. Fix these problems and check it again:\n${check.problems.map((problem) => `- ${problem}`).join('\n')}\n` };
  const { order, outOfScope, notInParallel } = check.plan;
  const waiting = outOfScope.length > 0 ? ` Left for the person to decide: ${outOfScope.map((item) => planItemLabel(items, item.task)).join(', ')}.` : '';
  return {
    ok: true,
    text: `The plan is valid: ${order.length} in the order, ${notInParallel.length} group(s) that cannot run at the same time, ${outOfScope.length} out of scope.${waiting} The person reviews it in Hatstand.\n`,
  };
}

export const planJsonSchema = (): string => JSON.stringify(z.toJSONSchema(backlogPlanSchema, { io: 'input' }));

export function backlogPromptInput(store: Store, paths: DataPaths, task: Task): BacklogPromptInput | undefined {
  if (!task.backlogPlan) return undefined;
  const ids = task.backlogPlan.items.map((item) => item.id);
  return {
    planFile: paths.planFile(task.companyId, task.id),
    items: store.listTasks(task.companyId).filter((item) => ids.includes(item.id)).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)),
    schema: planJsonSchema(),
  };
}
