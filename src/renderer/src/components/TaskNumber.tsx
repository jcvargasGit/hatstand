import type { Task } from '../../../shared/schemas';
import { formatTaskReference } from '../../../shared/task-reference';

export function TaskNumber({ task }: { task: Task }) {
  const reference = formatTaskReference(task);
  return reference === undefined ? null : <span className="task-number">{reference}</span>;
}
