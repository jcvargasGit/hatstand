import type { BacklogPlan, NotInParallel, OutOfScope, PlanStep } from '../../../shared/backlog-plan';

const without = (numbers: number[], number: number) => numbers.filter((item) => item !== number);

export function moveStep(plan: BacklogPlan, index: number, offset: -1 | 1): BacklogPlan {
  const target = index + offset;
  if (target < 0 || target >= plan.order.length) return plan;
  const order = [...plan.order];
  const [step] = order.splice(index, 1);
  if (step) order.splice(target, 0, step);
  return { ...plan, order };
}

export function changeStep(plan: BacklogPlan, task: number, change: Partial<Omit<PlanStep, 'task'>>): BacklogPlan {
  return { ...plan, order: plan.order.map((step) => (step.task === task ? { ...step, ...change } : step)) };
}

export function leaveOutOfScope(plan: BacklogPlan, task: number): BacklogPlan {
  if (!plan.order.some((step) => step.task === task)) return plan;
  return {
    ...plan,
    order: plan.order.filter((step) => step.task !== task),
    notInParallel: plan.notInParallel.map((group) => ({ ...group, tasks: without(group.tasks, task) })).filter((group) => group.tasks.length >= 2),
    outOfScope: [...plan.outOfScope, { task, decisionNeeded: '' }],
  };
}

export function bringIntoOrder(plan: BacklogPlan, task: number): BacklogPlan {
  if (!plan.outOfScope.some((item) => item.task === task)) return plan;
  return {
    ...plan,
    outOfScope: plan.outOfScope.filter((item) => item.task !== task),
    order: [...plan.order, { task, reason: '', dependsOn: [] }],
  };
}

export function changeOutOfScope(plan: BacklogPlan, task: number, change: Partial<Omit<OutOfScope, 'task'>>): BacklogPlan {
  return { ...plan, outOfScope: plan.outOfScope.map((item) => (item.task === task ? { ...item, ...change } : item)) };
}

export function addGroup(plan: BacklogPlan): BacklogPlan {
  return { ...plan, notInParallel: [...plan.notInParallel, { tasks: [], reason: '' }] };
}

export function changeGroup(plan: BacklogPlan, index: number, change: Partial<NotInParallel>): BacklogPlan {
  return { ...plan, notInParallel: plan.notInParallel.map((group, at) => (at === index ? { ...group, ...change } : group)) };
}

export function removeGroup(plan: BacklogPlan, index: number): BacklogPlan {
  return { ...plan, notInParallel: plan.notInParallel.filter((_group, at) => at !== index) };
}

export const clonePlan = (plan: BacklogPlan): BacklogPlan => structuredClone(plan);
