import { shownAreaName } from '../../../shared/areas';
import { taskTypeOf } from '../../../shared/task-types';
import { stepProgress, type TodayItem } from '../lib/today';
import { TaskNumber } from './TaskNumber';
import { TaskStateIcon } from './TaskStateIcon';
import { TaskTypeTag } from './TaskTypeTag';

type TaskLinkProps = {
  item: TodayItem;
  selected: boolean;
  showClient?: boolean;
  onSelect: () => void;
};

export function TaskLink({ item, selected, showClient = false, onSelect }: TaskLinkProps) {
  const detail = [showClient ? item.company.name : shownAreaName(item.company, item.task.subdomainId), stepProgress(item.task)].filter(Boolean).join(', ');
  const type = taskTypeOf(item.task, item.company);
  return (
    <button className="tree-task" title={item.task.title} aria-current={selected ? 'true' : undefined} onClick={onSelect}>
      <TaskStateIcon item={item} size={15} />
      <span className="tree-task-text">
        <span className="tree-task-title">
          <TaskNumber task={item.task} />
          {item.task.title}
        </span>
        {(type || detail) && (
          <small>
            {type && <TaskTypeTag type={type} guideName={item.task.guide?.name} />}
            {type && detail ? `, ${detail}` : detail}
          </small>
        )}
        {item.session?.state === 'needs-input' && <small className="tree-task-ask">Needs your answer</small>}
      </span>
    </button>
  );
}
