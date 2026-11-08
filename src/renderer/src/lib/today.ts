import type { Snapshot } from '../../../shared/api';
import { openPullsState, reviewTrouble } from '../../../shared/review';
import type { BranchFact, Company, PullRequest, Session, Task } from '../../../shared/schemas';
import { finishedWork } from '../../../shared/task-finish';

export const CLIENT_COLORS = ['#E8A33D', '#5BB8A6', '#8FA6F0', '#C58BD9', '#7CB65A', '#E58FB0', '#6CC3E8', '#E2725B'];
export const NEUTRAL_TINT = '#8C9AF2';

export type TodayItem = { task: Task; company: Company; session?: Session; pulls?: PullRequest[]; branches?: BranchFact[] };

export const READY_TO_CLOSE = 'Ready to close';

export type TodayGroups = {
  waiting: TodayItem[];
  working: TodayItem[];
  next: TodayItem[];
};

export function latestSession(sessions: Session[], taskId: string): Session | undefined {
  return sessions
    .filter((session) => session.taskId === taskId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

export const reviewFacts = (snapshot: Snapshot, taskId: string) => ({
  pulls: snapshot.reviews[taskId]?.pulls ?? [],
  branches: snapshot.reviews[taskId]?.branches ?? [],
});

export const isSessionBusy = (session: Session | undefined) => session?.state === 'working' || session?.state === 'background' || session?.state === 'needs-input';

export const isReadyToClose = (item: TodayItem) => !isSessionBusy(item.session) && finishedWork(item) !== null;

export const isFinished = (task: Task) => task.status === 'done' || task.archivedAt !== undefined;
export const isIdea = (task: Task) => task.status === 'idea';
export const closedAt = (task: Task) => task.doneAt ?? task.updatedAt;

const SESSION_STATE_TEXT = {
  'needs-input': 'Needs your answer',
  idle: 'Your turn',
  working: 'Working',
  background: 'Running in the background',
  stopped: 'Paused',
} as const;

export function taskStateText(item: TodayItem): string {
  const { task, session, pulls = [] } = item;
  if (task.archivedAt) return 'Archived';
  if (task.status === 'done') return 'Done';
  if (isReadyToClose(item)) return READY_TO_CLOSE;
  const pullState = openPullsState(pulls.filter((pull) => pull.state === 'open'));
  if (pullState && !isSessionBusy(session)) return pullState;
  if (session) return SESSION_STATE_TEXT[session.state];
  return task.status === 'doing' ? 'In progress' : 'Not started';
}

export function sharedSubdomain(company: Company, projectIds: string[]): string | undefined {
  const subdomains = new Set(company.projects.filter((project) => projectIds.includes(project.id)).map((project) => project.subdomainId));
  const [only] = subdomains;
  return subdomains.size === 1 ? only : undefined;
}

export const newestFirst = (a: TodayItem, b: TodayItem) => b.task.createdAt.localeCompare(a.task.createdAt) || b.task.id.localeCompare(a.task.id);

export function todayItems(snapshot: Snapshot, companyId: string | null): TodayItem[] {
  return snapshot.tasks.flatMap((task): TodayItem[] => {
    const company = snapshot.companies.find((item) => item.id === task.companyId);
    if (!company || isFinished(task) || isIdea(task)) return [];
    if (companyId && company.id !== companyId) return [];
    return [{ task, company, session: latestSession(snapshot.sessions, task.id), ...reviewFacts(snapshot, task.id) }];
  });
}

export function groupToday(snapshot: Snapshot, companyId: string | null): TodayGroups {
  const items = todayItems(snapshot, companyId);
  const state = (item: TodayItem) => item.session?.state ?? 'stopped';
  const inTrouble = (item: TodayItem) => reviewTrouble(item.pulls ?? []) !== null;
  const needsYou = (item: TodayItem) => state(item) === 'needs-input' || state(item) === 'idle' || (state(item) === 'stopped' && inTrouble(item));
  return {
    waiting: items.filter(needsYou).sort(newestFirst),
    working: items.filter((item) => state(item) === 'working' || state(item) === 'background').sort(newestFirst),
    next: items.filter((item) => state(item) === 'stopped' && !inTrouble(item)).sort(newestFirst),
  };
}

export type WaitingGroup = { company: Company; items: TodayItem[] };

export function waitingByClient(snapshot: Snapshot): WaitingGroup[] {
  const { waiting } = groupToday(snapshot, null);
  return snapshot.companies
    .filter((company) => !company.archivedAt)
    .map((company) => ({ company, items: waiting.filter((item) => item.company.id === company.id) }))
    .filter((group) => group.items.length > 0);
}

export function nextWaiting(snapshot: Snapshot, currentTaskId: string | null): TodayItem | undefined {
  const waiting = waitingByClient(snapshot).flatMap((group) => group.items);
  return waiting[(waiting.findIndex((item) => item.task.id === currentTaskId) + 1) % Math.max(waiting.length, 1)];
}

export function ideaCount(snapshot: Snapshot, companyId: string | null): number {
  return snapshot.tasks.filter((task) => isIdea(task) && !task.archivedAt && (companyId === null || task.companyId === companyId)).length;
}

export type ClientBranch = { company: Company; active: TodayItem[]; finished: TodayItem[] };

export function clientTree(snapshot: Snapshot, query = ''): ClientBranch[] {
  const term = query.trim().toLowerCase();
  const matches = (task: Task, company: Company) =>
    !term || [task.title, task.source?.key ?? '', company.name, task.number ? `#${task.number}` : ''].some((text) => text.toLowerCase().includes(term));
  return snapshot.companies.flatMap((company) => {
    const items = snapshot.tasks
      .filter((task) => task.companyId === company.id && !isIdea(task) && matches(task, company))
      .map((task) => ({ task, company, session: latestSession(snapshot.sessions, task.id), ...reviewFacts(snapshot, task.id) }));
    if (term && items.length === 0) return [];
    return [
      {
        company,
        active: items.filter((item) => !isFinished(item.task)).sort(newestFirst),
        finished: items.filter((item) => isFinished(item.task)).sort((a, b) => closedAt(b.task).localeCompare(closedAt(a.task))),
      },
    ];
  });
}

export function waitingCount(snapshot: Snapshot, companyId: string): number {
  return groupToday(snapshot, companyId).waiting.length;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  const letters = words.length > 1 ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}` : name.slice(0, 2);
  return letters.toUpperCase();
}

export function stepProgress(task: Task): string | null {
  return task.guide ? `step ${task.guide.current + 1} of ${task.guide.steps.length}` : null;
}

export function guideProgress(task: Task): string | null {
  return task.guide ? `${task.guide.name}, ${stepProgress(task)}` : null;
}

function luminance(color: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16) / 255);
  const [red = 0, green = 0, blue = 0] = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function inkOn(color: string): string {
  const background = luminance(color);
  const onDark = 1.05 / (background + 0.05);
  const onLight = (background + 0.05) / (luminance('#14171f') + 0.05);
  return onLight >= onDark ? '#14171f' : '#ffffff';
}
