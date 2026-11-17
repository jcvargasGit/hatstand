import { ChevronDown, ChevronRight } from 'lucide-react';
import type { MenuPoint } from '../lib/task-flag';
import { groupByGuide, type TodayItem } from '../lib/today';
import { TaskLink } from './TaskLink';

type TaskTreeProps = {
  /** Names the tree, such as "Acme tasks", and keeps its folded guides apart from other trees. */
  label: string;
  items: TodayItem[];
  selectedTaskId: string | null;
  /** The guides folded away, by the key of their group. */
  closed: string[];
  forceOpen?: boolean;
  onToggle: (key: string) => void;
  onSelect: (item: TodayItem) => void;
  onMenu: (item: TodayItem, at: MenuPoint) => void;
};

/** Tasks under the guide they follow: the one tree every list of tasks in the sidebar uses. */
export function TaskTree({ label, items, selectedTaskId, closed, forceOpen = false, onToggle, onSelect, onMenu }: TaskTreeProps) {
  return (
    <div className="task-tree" role="group" aria-label={label}>
      {groupByGuide(items).map((group) => {
        const key = `${label}:${group.key}`;
        const open = forceOpen || !closed.includes(key);
        return (
          <div key={group.key} className="task-tree-guide" role="group" aria-label={`${group.name} in ${label}`}>
            <button className="task-tree-guide-name" aria-expanded={open} title={open ? 'Fold this guide' : 'Show the tasks of this guide'} onClick={() => onToggle(key)}>
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span>{group.name}</span>
              <span className="task-tree-count">{group.items.length}</span>
            </button>
            {open &&
              group.items.map((item) => <TaskLink key={item.task.id} item={item} selected={item.task.id === selectedTaskId} onSelect={() => onSelect(item)} onMenu={(at) => onMenu(item, at)} />)}
          </div>
        );
      })}
    </div>
  );
}
