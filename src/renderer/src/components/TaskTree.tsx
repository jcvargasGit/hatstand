import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
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
  /** Starts a task that follows the guide of a group. The guide is empty for the tasks with no guide. */
  onAddTask?: (playbookId: string) => void;
};

/** Tasks under the guide they follow: the one tree every list of tasks in the sidebar uses. */
export function TaskTree({ label, items, selectedTaskId, closed, forceOpen = false, onToggle, onSelect, onMenu, onAddTask }: TaskTreeProps) {
  return (
    <div className="task-tree" role="group" aria-label={label}>
      {groupByGuide(items).map((group) => {
        const key = `${label}:${group.key}`;
        const open = forceOpen || !closed.includes(key);
        const addLabel = group.playbookId ? `New task with ${group.name}` : 'New task with no guide';
        return (
          <div key={group.key} className="task-tree-guide" role="group" aria-label={`${group.name} in ${label}`}>
            <div className="task-tree-guide-line">
              <button className="task-tree-guide-name" aria-expanded={open} title={open ? 'Fold this guide' : 'Show the tasks of this guide'} onClick={() => onToggle(key)}>
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span>{group.name}</span>
                <span className="task-tree-count">{group.items.length}</span>
              </button>
              {onAddTask && (
                <button className="tree-add-task" aria-label={`${addLabel}, in ${label}`} title={addLabel} onClick={() => onAddTask(group.playbookId)}>
                  <Plus size={13} />
                </button>
              )}
            </div>
            {open && (
              <div className="task-tree-guide-tasks">
                {group.items.map((item) => (
                  <TaskLink key={item.task.id} item={item} selected={item.task.id === selectedTaskId} onSelect={() => onSelect(item)} onMenu={(at) => onMenu(item, at)} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
