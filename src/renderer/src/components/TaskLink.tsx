import { shownAreaName } from '../../../shared/areas';
import { taskTypeOf } from '../../../shared/task-types';
import type { MouseEvent } from 'react';
import type { MenuPoint } from '../lib/task-flag';
import { stepProgress, type TodayItem } from '../lib/today';
import { TaskNumber } from './TaskNumber';
import { TaskStateIcon } from './TaskStateIcon';
import { TaskTypeTag } from './TaskTypeTag';

type TaskLinkProps = {
  item: TodayItem;
  selected: boolean;
  showClient?: boolean;
  onSelect: () => void;
  onMenu: (at: MenuPoint) => void;
};

export function TaskLink({ item, selected, showClient = false, onSelect, onMenu }: TaskLinkProps) {
  const detail = [showClient ? item.company.name : shownAreaName(item.company, item.task.subdomainId), stepProgress(item.task)].filter(Boolean).join(', ');
  const type = taskTypeOf(item.task, item.company);
  const flag = item.task.flag;
  const openMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const fromKeyboard = event.clientX === 0 && event.clientY === 0;
    const row = event.currentTarget.getBoundingClientRect();
    onMenu(fromKeyboard ? { x: row.left + 24, y: row.bottom } : { x: event.clientX, y: event.clientY });
  };
  return (
    <button className={flag ? 'tree-task is-flagged' : 'tree-task'} title={item.task.title} aria-current={selected ? 'true' : undefined} onClick={onSelect} onContextMenu={openMenu}>
      <TaskStateIcon item={item} size={15} />
      {flag && (
        <span className="tree-task-flag" role="img" aria-label={`Flagged ${flag}`}>
          {flag}
        </span>
      )}
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
