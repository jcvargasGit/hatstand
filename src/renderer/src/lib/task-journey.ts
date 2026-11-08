import { isCopilot, isCopilotReviewing, isReadyToMerge, reviewTrouble } from '../../../shared/review';
import { taskTypeOf } from '../../../shared/task-types';
import { workRepositories } from '../../../shared/work-repos';
import { finishedWork } from '../../../shared/task-finish';
import { MOVED_BY_YOU, placeOnBoard } from './board';
import { isReadyToClose, READY_TO_CLOSE, type TodayItem } from './today';

const IMPLEMENTATION_STAGES = ['Described', 'Planning', 'Implementing', 'Committed', 'PR open', 'Copilot review', 'Team review', 'Waiting for merge', 'Merged'];
const NO_REPOSITORY_STAGES = ['Described', 'Planning', 'Implementing', 'Done'];
const PLAIN_STAGES = ['Not started', 'In progress', 'Done'];
const FIRST_REVIEW_STAGE = 'PR open';

export type TaskJourney = {
  kind: string;
  stage: number;
  stages: string[];
  finished: boolean;
  reviewing: boolean;
  now: string;
  next: string;
};

const MOVED_STAGE: Record<string, string> = { 'in-review': 'Team review', ready: 'Waiting for merge', merged: 'Merged' };

const GUIDE_STEP_STAGE: Record<string, string> = {
  'Understand the task': 'Planning',
  'Plan the work': 'Planning',
  'Build it': 'Implementing',
  'Test it': 'Implementing',
  'Commit it': 'Committed',
  'Open the pull request': 'PR open',
  'Copilot review': 'Copilot review',
  'Team review': 'Team review',
};

export const SOURCE_NAMES = { jira: 'Jira ticket', github: 'GitHub issue', gitlab: 'GitLab issue' } as const;

function taskKind({ task }: TodayItem): string {
  const origin = task.source ? `${SOURCE_NAMES[task.source.kind]} ${task.source.key}` : 'Your own task';
  return task.guide ? `${origin}, with the guide ${task.guide.name}` : origin;
}

function nextGuideStep({ task }: TodayItem): string | null {
  const guide = task.guide;
  const step = guide?.steps[guide.current + 1];
  return step ? `Next in the guide: ${step.name}` : null;
}

const NEXT_FOR_TROUBLE: Record<string, string> = {
  'CI failing': 'Give the failure to the agent, or fix it yourself',
  'Changes requested': 'Give the comments to the agent, or answer them',
  'Merge conflict': 'Resolve the conflict with the main branch',
  'Open comments': 'Give the comments to the agent, or answer them',
};

const hasPulls = ({ pulls = [] }: TodayItem) => pulls.length > 0;
const followsImplementation = (item: TodayItem) => hasPulls(item) || taskTypeOf(item.task, item.company) === 'implementation';
const hasRepositories = (item: TodayItem) => hasPulls(item) || workRepositories(item.company).length > 0;

function usesCopilot({ pulls = [] }: TodayItem): boolean {
  return pulls.length === 0 || pulls.some((pull) => pull.copilot !== undefined || pull.comments.some((comment) => isCopilot(comment.author)));
}

function stagesOf(item: TodayItem): string[] {
  if (followsImplementation(item)) {
    if (!hasRepositories(item)) return NO_REPOSITORY_STAGES;
    return usesCopilot(item) ? IMPLEMENTATION_STAGES : IMPLEMENTATION_STAGES.filter((stage) => stage !== 'Copilot review');
  }
  if (item.task.guide) return [...item.task.guide.steps.map((step) => step.name), 'Done'];
  return PLAIN_STAGES;
}

function stageFromPulls({ pulls = [] }: TodayItem): string | null {
  if (pulls.length > 0 && pulls.every((pull) => pull.state === 'merged')) return 'Merged';
  const open = pulls.filter((pull) => pull.state === 'open');
  if (open.length === 0) return null;
  if (open.some((pull) => pull.draft)) return 'PR open';
  if (open.some(isCopilotReviewing)) return 'Copilot review';
  if (open.every(isReadyToMerge)) return 'Waiting for merge';
  return reviewTrouble(open) || open.some((pull) => pull.ci === 'running') ? 'Team review' : 'Waiting for merge';
}

function stageFromWork(item: TodayItem, commits: number): string {
  const { task, session } = item;
  const fromFacts = commits > 0 ? 'Committed' : task.worktrees.length > 0 ? 'Implementing' : session ? 'Planning' : 'Described';
  const step = task.guide?.steps[task.guide.current];
  const fromGuide = step ? (GUIDE_STEP_STAGE[step.name] ?? 'Described') : 'Described';
  return IMPLEMENTATION_STAGES.indexOf(fromGuide) > IMPLEMENTATION_STAGES.indexOf(fromFacts) ? fromGuide : fromFacts;
}

function implementationStage(item: TodayItem, commits: number): string {
  if (finishedWork(item) === 'merged') return 'Merged';
  const fromPulls = stageFromPulls(item);
  if (fromPulls) return fromPulls;
  const { lane, reason } = placeOnBoard(item);
  return (reason === MOVED_BY_YOU ? MOVED_STAGE[lane] : undefined) ?? stageFromWork(item, commits);
}

function stageIndex(item: TodayItem, stages: string[], commits: number): number {
  if (item.task.status === 'done' || item.task.archivedAt) return stages.length - 1;
  if (followsImplementation(item)) return Math.max(stages.indexOf(implementationStage(item, commits)), 0);
  if (item.task.guide) return Math.min(item.task.guide.current, stages.length - 2);
  const { reason } = placeOnBoard(item);
  return reason === 'Not started' ? 0 : 1;
}

function whereAndNext(item: TodayItem): { finished: boolean; now: string; next: string } {
  if (item.task.status === 'done' || item.task.archivedAt) {
    return { finished: true, now: item.task.archivedAt ? 'Archived' : 'Done', next: 'Nothing. This task is finished.' };
  }
  const { lane, reason } = placeOnBoard(item);
  const guideStep = nextGuideStep(item);
  const plan = (now: string, next: string) => ({ finished: false, now, next });
  if (reason === MOVED_BY_YOU) return plan(reason, 'Move it on the board, or mark it done');
  switch (lane) {
    case 'merged':
      return reason === READY_TO_CLOSE ? plan(reason, 'Close it, and remove its copy of the code') : plan(reason, 'Get the rest of the work into the main branch');
    case 'ready':
      return plan(reason, 'Merge the pull request');
    case 'in-review':
      return plan(reason, reason === 'Draft' ? 'Mark the pull request ready for review' : 'Wait for the review and the checks');
    case 'working':
      return plan(reason, 'The agent finishes its turn and comes back to you');
    case 'needs-you': {
      if (reason === READY_TO_CLOSE) return plan(reason, 'Close it, or reply to the agent');
      const reply = hasRepositories(item) ? 'Reply to the agent, or open a pull request' : 'Reply to the agent, or mark it done';
      return plan(reason, NEXT_FOR_TROUBLE[reason] ?? (reason === 'Needs your answer' ? 'Answer the agent in the terminal' : (guideStep ?? reply)));
    }
    default:
      return reason === 'Paused' ? plan(reason, guideStep ?? 'Resume the session, or start a new one from the notes') : plan(reason, 'Start a session');
  }
}

export function taskJourney(item: TodayItem, commits = 0): TaskJourney {
  const stages = stagesOf(item);
  const stage = stageIndex(item, stages, commits);
  const firstReview = stages.indexOf(FIRST_REVIEW_STAGE);
  return {
    kind: taskKind(item),
    stage,
    stages,
    reviewing: firstReview >= 0 && stage >= firstReview,
    ...whereAndNext(item),
  };
}

export function doneWarning(item: TodayItem): string | null {
  if (isReadyToClose(item)) return null;
  const { stages, stage, finished } = taskJourney(item);
  if (finished || stages === PLAIN_STAGES || stages === NO_REPOSITORY_STAGES) return null;
  const left = stages.slice(stage + 1).filter((name) => name !== 'Done');
  const last = left.at(-1);
  return last ? `This task has not reached ${last}.` : null;
}
