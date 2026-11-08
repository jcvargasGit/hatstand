import { ClipboardList, Code, Compass, FileText, FlaskConical, GitPullRequest, Rocket, Search, type LucideIcon } from 'lucide-react';
import type { TaskType } from '../../../shared/schemas';
import { taskTypeName } from '../../../shared/task-types';

const ICONS: Record<TaskType, LucideIcon> = {
  implementation: Code,
  'pr-review': GitPullRequest,
  investigation: Search,
  design: Compass,
  planning: ClipboardList,
  testing: FlaskConical,
  release: Rocket,
  report: FileText,
};

type TaskTypeTagProps = {
  type: TaskType;
  guideName?: string;
};

export function TaskTypeTag({ type, guideName }: TaskTypeTagProps) {
  const Icon = ICONS[type];
  return (
    <span className="task-type-tag" title={guideName}>
      <Icon size={12} aria-hidden="true" />
      {taskTypeName(type)}
    </span>
  );
}
