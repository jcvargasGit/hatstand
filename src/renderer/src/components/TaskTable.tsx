import type { TodayItem } from '../lib/today';
import { TaskRow } from './TaskRow';

type TaskTableProps = {
  items: TodayItem[];
  showClient: boolean;
  onSelect: (taskId: string) => void;
};

export function TaskTable({ items, showClient, onSelect }: TaskTableProps) {
  return (
    <table className="task-table">
      <thead>
        <tr>
          <th className="task-col-task">Task</th>
          {showClient && <th className="task-col-client">Client</th>}
          <th className="task-col-area">Area</th>
          <th className="task-col-priority">Priority</th>
          <th className="task-col-progress">Progress</th>
          <th className="task-col-status">Status</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <TaskRow key={item.task.id} item={item} showClient={showClient} onSelect={() => onSelect(item.task.id)} />
        ))}
      </tbody>
    </table>
  );
}
