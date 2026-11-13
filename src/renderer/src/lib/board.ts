import type { Snapshot } from '../../../shared/api';
import { hasWorkspace } from '../../../shared/readiness';
import { openPullsState, READY_TO_MERGE, reviewTrouble } from '../../../shared/review';
import type { TaskPatch } from '../../../shared/schemas';
import { DEFAULT_WORK_PERIOD, isInCurrentPeriod } from '../../../shared/work-periods';
import { finishedWork } from '../../../shared/task-finish';
import { closedAt, isReadyToClose, latestSession, newestFirst, READY_TO_CLOSE, reviewFacts, todayItems, type TodayItem } from './today';

export type LaneId = 'next' | 'working' | 'needs-you' | 'in-review' | 'ready' | 'merged' | 'done';

export type BoardCard = TodayItem & { reason: string };
export type BoardLane = { id: LaneId; title: string; cards: BoardCard[] };

export type BoardMove =
  | { kind: 'none' }
  | { kind: 'refuse'; reason: string }
  | { kind: 'patch'; patch: TaskPatch }
  | { kind: 'close'; sessionId: string; patch: TaskPatch }
  | { kind: 'start'; patch: TaskPatch }
  | { kind: 'resume'; sessionId: string; patch: TaskPatch };

export const MOVED_BY_YOU = 'Moved by you';
export const MERGED_WITH_WORK_LEFT = 'Merged, but work is left';

export const BOARD_LANES: { id: LaneId; title: string }[] = [
  { id: 'next', title: 'Up next' },
  { id: 'working', title: 'Working' },
  { id: 'needs-you', title: 'Needs you' },
  { id: 'in-review', title: 'In review' },
  { id: 'ready', title: 'Ready to merge' },
  { id: 'merged', title: 'Merged' },
  { id: 'done', title: 'Done' },
];

export function placeOnBoard(item: TodayItem): { lane: LaneId; reason: string } {
  const { session, task } = item;
  const pulls = item.pulls ?? [];
  const open = pulls.filter((pull) => pull.state === 'open');
  if (task.status === 'done') return { lane: 'done', reason: 'Done' };
  if (session?.state === 'needs-input') return { lane: 'needs-you', reason: 'Needs your answer' };
  if (session?.state === 'working') return { lane: 'working', reason: 'Agent is working' };
  if (session?.state === 'background') return { lane: 'working', reason: 'Running in the background' };
  const finished = finishedWork(item);
  if (finished) return { lane: finished === 'merged' ? 'merged' : 'needs-you', reason: READY_TO_CLOSE };
  if (pulls.length > 0 && pulls.every((pull) => pull.state === 'merged')) return { lane: 'merged', reason: MERGED_WITH_WORK_LEFT };
  const pullState = openPullsState(open);
  if (pullState) {
    if (reviewTrouble(open)) return { lane: 'needs-you', reason: pullState };
    return { lane: pullState === READY_TO_MERGE ? 'ready' : 'in-review', reason: pullState };
  }
  if (task.boardLane) return { lane: task.boardLane, reason: MOVED_BY_YOU };
  if (session?.state === 'idle') return { lane: 'needs-you', reason: 'Your turn' };
  return { lane: 'next', reason: session || task.status === 'doing' ? 'Paused' : 'Not started' };
}

export function moveOnBoard(item: TodayItem, target: LaneId): BoardMove {
  const { session, company } = item;
  const pulls = item.pulls ?? [];
  const current = placeOnBoard(item).lane;
  const running = session?.state === 'working' || session?.state === 'background' || session?.state === 'needs-input';
  const open = session !== undefined && session.state !== 'stopped';
  if (current === target) return { kind: 'none' };
  if (running) return { kind: 'refuse', reason: 'The agent is in this session, so its state decides where this task goes. Stop the session to move it.' };
  if (target === 'working') {
    if (open) return { kind: 'refuse', reason: 'This session is already open and waiting for you. Answer it in the terminal.' };
    if (!hasWorkspace(company)) return { kind: 'refuse', reason: `Add an area, a repository or a client folder to ${company.name} first.` };
    const patch: TaskPatch = { boardLane: undefined, status: 'doing' };
    return session ? { kind: 'resume', sessionId: session.id, patch } : { kind: 'start', patch };
  }
  if (target === 'done') {
    const patch: TaskPatch = { status: 'done', boardLane: undefined };
    if (!open) return { kind: 'patch', patch };
    return isReadyToClose(item) ? { kind: 'close', sessionId: session.id, patch } : { kind: 'refuse', reason: 'Stop the session before marking this task done.' };
  }
  const status = session || target !== 'next' ? 'doing' : 'todo';
  const boardLane = target === 'next' ? undefined : target;
  if (current === 'done') return { kind: 'patch', patch: { status, boardLane } };
  const [pull] = pulls;
  if (pull) return { kind: 'refuse', reason: `Pull request ${pull.repo} #${pull.number} decides where this task goes.` };
  return { kind: 'patch', patch: { status, boardLane } };
}

function doneItems(snapshot: Snapshot, companyId: string | null, now: Date): TodayItem[] {
  return snapshot.tasks
    .filter((task) => task.status === 'done' && !task.archivedAt && (!companyId || task.companyId === companyId))
    .sort((a, b) => closedAt(b).localeCompare(closedAt(a)))
    .flatMap((task) => {
      const company = snapshot.companies.find((item) => item.id === task.companyId);
      if (!company || !isInCurrentPeriod(company.workPeriod ?? DEFAULT_WORK_PERIOD, closedAt(task), now)) return [];
      return [{ task, company, session: latestSession(snapshot.sessions, task.id), ...reviewFacts(snapshot, task.id) }];
    });
}

export function boardLanes(snapshot: Snapshot, companyId: string | null, now = new Date()): BoardLane[] {
  const open = todayItems(snapshot, companyId).sort(newestFirst);
  const placed = [...open, ...doneItems(snapshot, companyId, now)].map((item) => ({ item, ...placeOnBoard(item) }));
  return BOARD_LANES.map((lane) => ({
    ...lane,
    cards: placed.filter((entry) => entry.lane === lane.id).map((entry) => ({ ...entry.item, reason: entry.reason })),
  }));
}
