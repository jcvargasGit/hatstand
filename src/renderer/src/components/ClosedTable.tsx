import type { Task } from '../../../shared/schemas';
import { dateLabel, localDateKey } from '../../../shared/work-periods';
import { descriptionSummary } from '../lib/closed-tasks';
import { SOURCE_NAMES } from '../lib/task-journey';
import { closedAt } from '../lib/today';
import { TaskNumber } from './TaskNumber';

type ClosedTableProps = {
  tasks: Task[];
  areaName: (task: Task) => string;
  onOpenTask: (taskId: string) => void;
};

function closedDate(task: Task): string {
  const date = dateLabel(localDateKey(closedAt(task)));
  return task.doneAt ? date : `About ${date}`;
}

function TicketCell({ task }: { task: Task }) {
  const source = task.source;
  if (!source) return <td className="closed-col-ticket" />;
  const name = `${SOURCE_NAMES[source.kind]} ${source.key}`;
  return (
    <td className="closed-col-ticket closed-cut" title={name}>
      {source.url ? (
        <a href={source.url} target="_blank" rel="noreferrer" aria-label={`Open ${name}`}>
          {source.key}
        </a>
      ) : (
        source.key
      )}
    </td>
  );
}

export function ClosedTable({ tasks, areaName, onOpenTask }: ClosedTableProps) {
  const showTicket = tasks.some((task) => task.source);
  const showArea = tasks.some((task) => areaName(task));

  return (
    <table className="project-table closed-table">
      <thead>
        <tr>
          <th>Task</th>
          {showTicket && <th className="closed-col-ticket">Ticket</th>}
          <th className="closed-col-guide">Guide</th>
          {showArea && <th className="closed-col-area">Area</th>}
          <th className="closed-col-date">Closed</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => {
          const area = areaName(task);
          const summary = descriptionSummary(task.description);
          return (
            <tr key={task.id}>
              <td>
                <button className="closed-task" title={task.title} onClick={() => onOpenTask(task.id)}>
                  <span className="closed-task-title">
                    <TaskNumber task={task} />
                    {task.title}
                  </span>
                  {summary && (
                    <span className="closed-task-summary" title={summary}>
                      {summary}
                    </span>
                  )}
                </button>
              </td>
              {showTicket && <TicketCell task={task} />}
              <td className="closed-col-guide closed-cut" title={task.guide?.name}>
                {task.guide?.name}
              </td>
              {showArea && (
                <td className="closed-col-area closed-cut" title={area}>
                  {area}
                </td>
              )}
              <td className="closed-date">{closedDate(task)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
