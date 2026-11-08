import type { Task } from '../../../shared/schemas';

export function TaskNumber({ task }: { task: Task }) {
  return task.number === undefined ? null : <span className="task-number">#{task.number}</span>;
}
