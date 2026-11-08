import type { TaskPriority } from '../../../shared/schemas';
import { PRIORITIES } from '../lib/inbox';

type PrioritySelectProps = {
  value: TaskPriority;
  label: string;
  onChange: (priority: TaskPriority) => void;
};

export function PrioritySelect({ value, label, onChange }: PrioritySelectProps) {
  return (
    <select className={`priority-select is-${value}`} aria-label={label} value={value} onChange={(event) => onChange(event.target.value as TaskPriority)}>
      {PRIORITIES.map((priority) => (
        <option key={priority.value} value={priority.value}>
          {priority.label}
        </option>
      ))}
    </select>
  );
}
