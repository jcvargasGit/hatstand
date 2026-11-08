import { Activity, Archive, Bug, Check, CheckCircle2, Circle, CircleAlert, CircleDashed, CirclePause, CircleUserRound, CircleX, Clock, GitPullRequest, LoaderCircle, type LucideIcon } from 'lucide-react';
import { openPullsState, READY_TO_MERGE } from '../../../shared/review';
import { isReadyToClose, isSessionBusy, READY_TO_CLOSE, type TodayItem } from '../lib/today';

type StateLook = { Icon: LucideIcon; className?: string; label: string; meaning: string };

const SESSION_LOOKS = {
  working: { Icon: LoaderCircle, className: 'state-icon-working', label: 'Working', meaning: 'The agent is processing this task.' },
  background: { Icon: Activity, className: 'state-icon-background', label: 'Running in the background', meaning: 'The agent ended its turn and left work running, such as tests. It comes back when that work finishes, and you can write to it now.' },
  'needs-input': { Icon: CircleAlert, className: 'state-icon-ask', label: 'Needs your answer', meaning: 'The agent is stopped until you answer or approve something in the terminal.' },
  idle: { Icon: CircleUserRound, className: 'state-icon-turn', label: 'Your turn', meaning: 'The agent finished and is waiting for your next message.' },
  stopped: { Icon: CirclePause, label: 'Paused', meaning: 'No agent is running. Resume the session to continue.' },
} as const satisfies Record<string, StateLook>;

const READY_LOOK: StateLook = { Icon: CheckCircle2, className: 'state-icon-ready', label: READY_TO_CLOSE, meaning: 'Nothing is left in this task. Check it and close it.' };

const COMMENTS_LOOK = { Icon: Bug, className: 'state-icon-ask', meaning: 'The pull request has feedback to answer before it can be merged.' };
const REVIEW_LOOK = { Icon: Clock, meaning: 'Waiting for the team or the checks. Nothing is needed from you yet.' };
const OPEN_PULL_LOOK = { Icon: GitPullRequest, meaning: 'The pull request is not ready for the team to approve yet.' };

const PULL_LOOKS: Record<string, StateLook> = {
  'Open comments': { ...COMMENTS_LOOK, label: 'Open comments' },
  'Changes requested': { ...COMMENTS_LOOK, label: 'Changes requested' },
  'CI failing': { Icon: CircleX, className: 'state-icon-bad', label: 'CI failing', meaning: 'A check failed on the pull request.' },
  'Merge conflict': { Icon: CircleX, className: 'state-icon-bad', label: 'Merge conflict', meaning: 'The pull request conflicts with the main branch.' },
  'Waiting for review': { ...REVIEW_LOOK, label: 'Waiting for review' },
  'CI running': { ...REVIEW_LOOK, label: 'CI running' },
  Draft: { ...OPEN_PULL_LOOK, label: 'Draft' },
  'Copilot reviewing': { ...OPEN_PULL_LOOK, label: 'Copilot reviewing' },
  [READY_TO_MERGE]: { Icon: Check, label: READY_TO_MERGE, meaning: 'The pull request passed its reviews and checks. Merge it to finish.' },
};

function stateLook(item: TodayItem): StateLook {
  const { task, session, pulls = [] } = item;
  if (task.archivedAt) return { Icon: Archive, label: 'Archived', meaning: 'This task is out of your lists. Restore it to work on it again.' };
  if (task.status === 'done') return { Icon: CheckCircle2, label: 'Done', meaning: 'This task is finished. Reopen it if something is left.' };
  if (session && isSessionBusy(session)) return SESSION_LOOKS[session.state];
  if (isReadyToClose(item)) return READY_LOOK;
  const pullLook = PULL_LOOKS[openPullsState(pulls.filter((pull) => pull.state === 'open')) ?? ''];
  if (pullLook) return pullLook;
  if (session) return SESSION_LOOKS[session.state];
  if (task.status === 'doing') return { Icon: CircleDashed, label: 'In progress', meaning: 'You are working on this task, without an agent session.' };
  return { Icon: Circle, label: 'Not started', meaning: 'No agent has worked on this task yet.' };
}

export function TaskStateIcon({ item, size = 18 }: { item: TodayItem; size?: number }) {
  const { Icon, className, label, meaning } = stateLook(item);
  const description = `${label}. ${meaning}`;
  return (
    <span className="state-icon-box" role="img" aria-label={label} title={description}>
      <Icon className={className ? `state-icon ${className}` : 'state-icon'} size={size} aria-hidden="true" />
    </span>
  );
}
