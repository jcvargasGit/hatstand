import type { Company, Task, TaskType } from './schemas';
import { workRepositories } from './work-repos';

const TYPE_NAMES: Record<TaskType, string> = {
  implementation: 'Implementation',
  'pr-review': 'PR review',
  investigation: 'Investigation',
  design: 'Design',
  planning: 'Planning',
  testing: 'Testing',
  release: 'Release',
  report: 'Report',
};

const GUIDE_TYPES: Record<string, TaskType> = {
  implement: 'implementation',
  'pr-review': 'pr-review',
  bug: 'investigation',
  'aws-debug': 'investigation',
  observability: 'investigation',
  rfc: 'design',
  backlog: 'planning',
  testing: 'testing',
  release: 'release',
  report: 'report',
};

export function taskTypeOf(task: Pick<Task, 'type' | 'guide'>, company: Company): TaskType | undefined {
  if (task.type) return task.type;
  const fromGuide = task.guide && (task.guide.type ?? GUIDE_TYPES[task.guide.playbookId]);
  if (fromGuide) return fromGuide;
  return workRepositories(company).length > 0 ? 'implementation' : undefined;
}

export const taskTypeName = (type: TaskType | undefined) => type && TYPE_NAMES[type];

export const starterGuideId = (company: Company): string | undefined => (workRepositories(company).length > 0 ? 'implement' : undefined);
