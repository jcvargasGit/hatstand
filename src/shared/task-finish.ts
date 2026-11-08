import type { BranchFact, Company, PullRequest, Task } from './schemas';
import { taskTypeOf } from './task-types';
import { workRepositories } from './work-repos';

export type FinishFacts = { task: Task; company: Company; pulls?: PullRequest[]; branches?: BranchFact[] };
export type FinishedWork = 'merged' | 'reported';

const mergedIntoMain = (pull: PullRequest) => pull.state === 'merged' && pull.intoMain !== false;

function copyIsInMain(branch: BranchFact, pull: PullRequest | undefined): boolean {
  return branch.clean && (branch.inMain || (pull !== undefined && mergedIntoMain(pull)));
}

export function finishedWork({ task, company, pulls = [], branches = [] }: FinishFacts): FinishedWork | null {
  if (task.status === 'idea' || task.status === 'done' || task.archivedAt) return null;
  if (pulls.some((pull) => pull.state === 'open')) return null;
  const pullOf = (projectId: string) => pulls.find((pull) => pull.projectId === projectId);
  const copies = branches.filter((branch) => branch.hasWork || !branch.clean || pullOf(branch.projectId));
  const pullsWithoutCopy = pulls.filter((pull) => !branches.some((branch) => branch.projectId === pull.projectId));
  if (copies.length + pullsWithoutCopy.length > 0) {
    const allInMain = copies.every((branch) => copyIsInMain(branch, pullOf(branch.projectId))) && pullsWithoutCopy.every(mergedIntoMain);
    return allInMain ? 'merged' : null;
  }
  const needsMerge = taskTypeOf(task, company) === 'implementation' && workRepositories(company).length > 0;
  return !needsMerge && task.agentStatus === 'done' ? 'reported' : null;
}
