import { checklistProgress, priorityLabel } from '../lib/inbox';
import { shownAreaName } from '../../../shared/areas';
import { guideProgress, taskStateText, type TodayItem } from '../lib/today';
import { ClientAvatar } from './ClientAvatar';
import { TaskNumber } from './TaskNumber';
import { TaskStateIcon } from './TaskStateIcon';

type TaskRowProps = {
  item: TodayItem;
  showClient: boolean;
  onSelect: () => void;
};

export function TaskRow({ item, showClient, onSelect }: TaskRowProps) {
  const { task, company, session } = item;
  const area = shownAreaName(company, task.subdomainId);
  const state = taskStateText(item);
  const progress = [guideProgress(task), task.checklist.length > 0 ? checklistProgress(task) : null].filter(Boolean).join(', ');
  const details = [showClient ? company.name : null, area ?? null, task.source?.key ?? null, progress || null, state].filter(Boolean);

  return (
    <tr className={`task-row state-${session?.state ?? 'none'}`} onClick={onSelect}>
      <td className="task-col-task">
        <button className="task-open" title={task.title}>
          <TaskStateIcon item={item} />
          <span className="task-text">
            <span className="task-title">
              <TaskNumber task={task} />
              {task.source && <span className="task-key">{task.source.key}</span>}
              {task.title}
            </span>
            <span className="task-details">{details.join(', ')}</span>
          </span>
        </button>
      </td>
      {showClient && (
        <td className="task-col-client">
          <span className="task-client">
            <ClientAvatar company={company} size="small" />
            <span>{company.name}</span>
          </span>
        </td>
      )}
      <td className="task-col-area">{area}</td>
      <td className={`task-col-priority is-${task.priority}`}>{priorityLabel(task.priority)}</td>
      <td className="task-col-progress">{progress}</td>
      <td className="task-col-status">{state}</td>
    </tr>
  );
}
