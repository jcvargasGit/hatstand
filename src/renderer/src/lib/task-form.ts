import type { PlaybookSummary, Snapshot } from '../../../shared/api';
import type { Company, Task, TaskPriority } from '../../../shared/schemas';
import { starterGuideId } from '../../../shared/task-types';
import { suggestedRepositoryIds } from '../../../shared/work-repos';
import { sharedSubdomain } from './today';

/** The choices of a task besides its title and description. The same for a new task, an inbox item, and a task's settings. */
export type TaskChoices = {
  companyId: string;
  playbookId: string;
  areaId: string;
  accountId: string;
  priority: TaskPriority;
  isolated: boolean;
  projectIds: string[];
};

/** Guides used most first. Guides used as often keep their order, so built-in guides stay in place until you use one. */
export function orderGuidesByUse(playbooks: PlaybookSummary[], usage: Record<string, number>): PlaybookSummary[] {
  return playbooks
    .map((playbook, index) => ({ playbook, index, uses: usage[playbook.id] ?? 0 }))
    .sort((a, b) => b.uses - a.uses || a.index - b.index)
    .map(({ playbook }) => playbook);
}

export const defaultAccountId = (snapshot: Pick<Snapshot, 'accounts'>, company: Company | undefined): string => company?.defaultAccountId ?? snapshot.accounts.defaultAccountId ?? '';

/** The guide a new task starts with: the client's default, else Implement a task when that setting is on. */
export function suggestedGuide(snapshot: Pick<Snapshot, 'guideNewTasks'>, company: Company | undefined, playbooks: PlaybookSummary[]): string {
  const available = (id?: string) => playbooks.find((playbook) => playbook.id === id)?.id;
  const starter = snapshot.guideNewTasks && company ? starterGuideId(company) : undefined;
  return available(company?.defaultPlaybookId) ?? available(starter) ?? '';
}

/** The area a task gets when the person has not chosen one: the one its repositories share, or the client's default. */
export function suggestedArea(company: Company | undefined, projectIds: string[]): string {
  if (!company) return '';
  return sharedSubdomain(company, projectIds) ?? company.defaultAreaId ?? '';
}

export function newTaskChoices(snapshot: Pick<Snapshot, 'accounts' | 'companies'>, companyId: string, areaId?: string): TaskChoices {
  const company = snapshot.companies.find((item) => item.id === companyId);
  const projectIds = company ? suggestedRepositoryIds(company, areaId) : [];
  return {
    companyId,
    playbookId: '',
    areaId: areaId ?? suggestedArea(company, projectIds),
    accountId: defaultAccountId(snapshot, company),
    priority: 'none',
    isolated: true,
    projectIds,
  };
}

/** The choices an inbox item or an existing task already has. */
export function choicesOf(task: Task, snapshot: Pick<Snapshot, 'accounts' | 'companies'>): TaskChoices {
  const company = snapshot.companies.find((item) => item.id === task.companyId);
  return {
    companyId: task.companyId,
    playbookId: task.guide?.playbookId ?? '',
    areaId: task.subdomainId ?? suggestedArea(company, task.projectIds),
    accountId: task.accountId ?? defaultAccountId(snapshot, company),
    priority: task.priority,
    isolated: task.isolated,
    projectIds: task.projectIds,
  };
}
