import type { Task, TaskPriority } from '../../../shared/schemas';

export const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'none', label: 'No priority' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const PRIORITY_WEIGHT: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2, none: 3 };

export function inboxOrder(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || b.createdAt.localeCompare(a.createdAt));
}

export function byPriority(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority]);
}

export function priorityLabel(priority: TaskPriority): string {
  return priority === 'none' ? '' : (PRIORITIES.find((item) => item.value === priority)?.label ?? '');
}

export function firstLine(text: string): string {
  return text.split('\n')[0] ?? '';
}

export function ideaTitleId(taskId: string): string {
  return `idea-title-${taskId}`;
}

export function checklistProgress(task: Pick<Task, 'checklist'>): string {
  return `${task.checklist.filter((item) => item.done).length} of ${task.checklist.length} done`;
}
