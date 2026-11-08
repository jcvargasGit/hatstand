import { z } from 'zod';

export const BACKLOG_PLAN_VERSION = 1;

const taskNumber = z
  .number({ error: 'Write the task number as a number, such as 12, without #.' })
  .int('Write the task number as a whole number, such as 12.')
  .positive('Write the task number as a whole number, such as 12.');

export const planStepSchema = z.object({
  task: taskNumber.describe('Number of a selected task, such as 12 for #12.'),
  reason: z.string().trim().default('').describe('Why it goes at this point of the order.'),
  dependsOn: z.array(taskNumber).default([]).describe('Numbers of the tasks that must be finished before this one starts. Each must come earlier in the order.'),
});

export const notInParallelSchema = z.object({
  tasks: z.array(taskNumber).min(2, 'A group of tasks that cannot run at the same time needs at least two tasks.').describe('Numbers of tasks in the order that must not be developed at the same time.'),
  reason: z.string().trim().min(1, 'Say why these tasks cannot be developed at the same time.').describe('Why, such as the same files, the same migration or the same environment.'),
});

export const outOfScopeSchema = z.object({
  task: taskNumber.describe('Number of a selected task left out of this plan.'),
  decisionNeeded: z.string().trim().min(1, 'Write the decision the person has to make.').describe('The question or decision the person has to settle before this task can be planned.'),
});

export const backlogPlanSchema = z.object({
  version: z.literal(BACKLOG_PLAN_VERSION),
  summary: z.string().trim().default('').describe('Two or three sentences on the plan as a whole.'),
  order: z.array(planStepSchema).describe('The tasks to build, in the order to build them.'),
  notInParallel: z.array(notInParallelSchema).default([]).describe('Groups of tasks that must not be developed at the same time.'),
  outOfScope: z.array(outOfScopeSchema).default([]).describe('Tasks left out because they need a decision from the person first.'),
});

export type BacklogPlan = z.infer<typeof backlogPlanSchema>;
export type BacklogPlanInput = z.input<typeof backlogPlanSchema>;
export type PlanStep = z.infer<typeof planStepSchema>;
export type NotInParallel = z.infer<typeof notInParallelSchema>;
export type OutOfScope = z.infer<typeof outOfScopeSchema>;

export type PlanItem = { id: string; number: number; title: string; deleted?: boolean };

export type PlanCheck = { success: true; plan: BacklogPlan } | { success: false; problems: string[]; messages: string[] };

export function planItemsFrom(selected: { id: string; number: number }[], tasks: { id: string; title: string }[]): PlanItem[] {
  return selected.map(({ id, number }) => {
    const task = tasks.find((candidate) => candidate.id === id);
    return task ? { id, number, title: task.title } : { id, number, title: '', deleted: true };
  });
}

export function planItemName(items: PlanItem[], number: number): string {
  const item = items.find((candidate) => candidate.number === number);
  if (!item) return `#${number}`;
  return item.deleted ? `#${number} (deleted)` : `#${number} ${item.title}`;
}

export function planItemLabel(items: PlanItem[], number: number): string {
  const item = items.find((candidate) => candidate.number === number);
  if (!item) return `#${number}`;
  return item.deleted ? `#${number}, a deleted task,` : `#${number} "${item.title}"`;
}

function issuePath(path: PropertyKey[]): string {
  return path.reduce<string>((text, part) => (typeof part === 'number' ? `${text}[${part}]` : text ? `${text}.${String(part)}` : String(part)), '');
}

function crossChecks(plan: BacklogPlan, items: PlanItem[], ctx: z.RefinementCtx): void {
  const label = (number: number) => planItemLabel(items, number);
  const known = new Set(items.map((item) => item.number));
  const problem = (message: string, path: PropertyKey[]) => ctx.addIssue({ code: 'custom', message, path });

  const placed = new Map<number, string>();
  const place = (number: number, where: string, path: PropertyKey[]) => {
    if (!known.has(number)) problem(`${label(number)} is not one of the selected tasks.`, path);
    const earlier = placed.get(number);
    if (earlier) problem(`${label(number)} appears twice: in ${earlier} and in ${where}. Put each task in one place.`, path);
    else placed.set(number, where);
  };
  plan.order.forEach((step, index) => place(step.task, 'the order', ['order', index, 'task']));
  plan.outOfScope.forEach((item, index) => place(item.task, 'out of scope', ['outOfScope', index, 'task']));

  for (const item of items) {
    if (!item.deleted && !placed.has(item.number)) problem(`${label(item.number)} is missing. Put it in the order, or out of scope with the decision it needs.`, []);
  }

  const position = new Map(plan.order.map((step, index) => [step.task, index]));
  plan.order.forEach((step, index) => {
    const seen = new Set<number>();
    step.dependsOn.forEach((dependency, dependencyIndex) => {
      const path = ['order', index, 'dependsOn', dependencyIndex];
      if (seen.has(dependency)) return problem(`${label(step.task)} lists ${label(dependency)} twice as a dependency.`, path);
      seen.add(dependency);
      if (dependency === step.task) return problem(`${label(step.task)} cannot depend on itself.`, path);
      const at = position.get(dependency);
      if (at === undefined) {
        const waiting = plan.outOfScope.some((item) => item.task === dependency);
        return problem(
          waiting
            ? `${label(step.task)} depends on ${label(dependency)}, which waits for a decision. Move ${label(step.task)} out of scope too, or remove the dependency.`
            : `${label(step.task)} depends on ${label(dependency)}, which is not in the order.`,
          path,
        );
      }
      if (at > index) problem(`${label(step.task)} depends on ${label(dependency)}, so ${label(dependency)} has to come first in the order.`, path);
    });
  });

  plan.notInParallel.forEach((group, index) => {
    const seen = new Set<number>();
    group.tasks.forEach((number, numberIndex) => {
      const path = ['notInParallel', index, 'tasks', numberIndex];
      if (seen.has(number)) return problem(`A group that cannot run at the same time lists ${label(number)} twice.`, path);
      seen.add(number);
      if (!position.has(number)) problem(`${label(number)} is in a group that cannot run at the same time, but it is not in the order.`, path);
    });
  });
}

export function checkBacklogPlan(raw: unknown, items: PlanItem[]): PlanCheck {
  const result = backlogPlanSchema.superRefine((plan, ctx) => crossChecks(plan, items, ctx)).safeParse(raw);
  if (result.success) return { success: true, plan: result.data };
  const problems = result.error.issues.map((issue) => {
    const where = issuePath(issue.path);
    return where ? `${where}: ${issue.message}` : issue.message;
  });
  return { success: false, problems: [...new Set(problems)], messages: [...new Set(result.error.issues.map((issue) => issue.message))] };
}

export function parsePlanText(text: string, items: PlanItem[]): PlanCheck {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const problem = `This is not valid JSON. ${error instanceof Error ? error.message : ''}`.trim();
    return { success: false, problems: [problem], messages: [problem] };
  }
  return checkBacklogPlan(raw, items);
}

export function planText(plan: BacklogPlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}
