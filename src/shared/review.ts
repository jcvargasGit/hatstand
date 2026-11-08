import type { PullRequest, ReviewComment } from './schemas';

export const READY_TO_MERGE = 'Ready for you to merge';

export const isCopilot = (author: string) => /copilot/i.test(author);

export const openThreads = (pull: PullRequest): ReviewComment[] => pull.comments.filter((comment) => comment.resolvable);

export const isCopilotReviewing = (pull: PullRequest) => pull.copilot === 'pending' || openThreads(pull).some((comment) => isCopilot(comment.author));

export function pullTrouble(pull: PullRequest): string | null {
  if (pull.state !== 'open') return null;
  if (pull.ci === 'failing') return 'CI failing';
  if (pull.review === 'changes-requested') return 'Changes requested';
  if (pull.conflicts) return 'Merge conflict';
  return openThreads(pull).length > 0 ? 'Open comments' : null;
}

export function reviewTrouble(pulls: PullRequest[]): string | null {
  for (const pull of pulls) {
    const trouble = pullTrouble(pull);
    if (trouble) return trouble;
  }
  return null;
}

export function openPullsState(open: PullRequest[]): string | null {
  if (open.length === 0) return null;
  const trouble = reviewTrouble(open);
  if (trouble) return trouble;
  if (open.every(isReadyToMerge)) return READY_TO_MERGE;
  if (open.some((pull) => pull.ci === 'running')) return 'CI running';
  if (open.some((pull) => pull.draft)) return 'Draft';
  return open.some(isCopilotReviewing) ? 'Copilot reviewing' : 'Waiting for review';
}

const reviewIsSettled = (pull: PullRequest) => pull.review === 'approved' || (pull.review === 'none' && pull.reviewRequired === false);

export const isReadyToMerge = (pull: PullRequest) =>
  pull.state === 'open' && !pull.draft && !pull.conflicts && pull.copilot !== 'pending' && openThreads(pull).length === 0 && reviewIsSettled(pull) && (pull.ci === 'passing' || pull.ci === 'none');

export type PullChip = { text: string; tone: 'good' | 'bad' | 'neutral' };

function reviewChip(pull: PullRequest): PullChip | null {
  if (pull.review === 'approved') return { text: 'Approved', tone: 'good' };
  if (pull.review === 'changes-requested') return { text: 'Changes requested', tone: 'bad' };
  return pull.reviewRequired === false ? null : { text: 'Waiting for review', tone: 'neutral' };
}

export function pullChips(pull: PullRequest): PullChip[] {
  if (pull.state === 'merged') return [{ text: 'Merged', tone: 'good' }];
  if (pull.state === 'closed') return [{ text: 'Closed', tone: 'neutral' }];
  const ci: Record<PullRequest['ci'], PullChip | null> = {
    passing: { text: 'CI passing', tone: 'good' },
    failing: { text: 'CI failing', tone: 'bad' },
    running: { text: 'CI running', tone: 'neutral' },
    none: null,
  };
  const chips: (PullChip | null)[] = [
    pull.draft ? { text: 'Draft', tone: 'neutral' } : null,
    ci[pull.ci],
    reviewChip(pull),
    pull.copilot === 'pending' ? { text: 'Copilot reviewing', tone: 'neutral' } : null,
    pull.conflicts ? { text: 'Merge conflict', tone: 'bad' } : null,
    pull.comments.length > 0 ? { text: `${pull.comments.length} ${pull.comments.length === 1 ? 'comment' : 'comments'}`, tone: 'neutral' } : null,
  ];
  return chips.filter((chip): chip is PullChip => chip !== null);
}
