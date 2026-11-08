import { Check, ExternalLink, GitBranch, Play, Square } from 'lucide-react';
import { shownAreaName } from '../../../shared/areas';
import { pullChips } from '../../../shared/review';
import type { Account } from '../../../shared/schemas';
import { BOARD_LANES, placeOnBoard, type BoardCard, type LaneId } from '../lib/board';
import { checklistProgress } from '../lib/inbox';
import { timeAgo } from '../lib/text';
import { guideProgress, isReadyToClose } from '../lib/today';
import { ClientAvatar } from './ClientAvatar';
import { PullChips } from './PullChips';
import { TaskNumber } from './TaskNumber';
import { TaskStateIcon } from './TaskStateIcon';

type TaskBoardCardProps = {
  card: BoardCard;
  showClient: boolean;
  accounts: Account[];
  busy: boolean;
  onSelect: () => void;
  onMove: (lane: LaneId) => void;
  onStop: () => void;
  onOpenInEditor: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
};

export function TaskBoardCard({ card, showClient, accounts, busy, onSelect, onMove, onStop, onOpenInEditor, onDragStart, onDragEnd }: TaskBoardCardProps) {
  const { task, session, company } = card;
  const title = task.title;
  const isDone = task.status === 'done';
  const isLive = session !== undefined && session.state !== 'stopped';
  const readyToClose = isReadyToClose(card);
  const account = accounts.find((item) => item.id === (session?.accountId ?? task.accountId));
  const [worktree, ...otherCopies] = task.worktrees;
  const facts = [
    showClient ? company.name : null,
    shownAreaName(company, task.subdomainId) ?? null,
    task.source?.key ?? null,
    task.priority === 'none' ? null : `${task.priority} priority`,
    guideProgress(task),
    task.checklist.length > 0 ? checklistProgress(task) : null,
  ].filter(Boolean);

  return (
    <li>
      <article className="board-card" draggable onDragStart={onDragStart} onDragEnd={onDragEnd} aria-label={title}>
        <button className="board-card-open" title={title} onClick={onSelect}>
          <span className="board-card-title">
            {showClient && <ClientAvatar company={company} size="small" />}
            <span>
              <TaskNumber task={task} />
              {title}
            </span>
          </span>
        </button>
        <span className="board-card-state">
          <TaskStateIcon item={card} size={13} />
          <small className="board-card-reason">{card.reason}</small>
        </span>
        {facts.length > 0 && <small>{facts.join(', ')}</small>}
        {worktree && (
          <small className="board-card-branch" title={worktree.branch}>
            <GitBranch size={12} />
            <span>{worktree.branch}</span>
            {otherCopies.length > 0 && <span>+{otherCopies.length}</span>}
          </small>
        )}
        {(card.pulls ?? []).map((pull) => (
          <span key={`${pull.projectId}-${pull.number}`} className="board-card-pull">
            <small>
              {pull.repo} #{pull.number}
            </small>
            <PullChips chips={pullChips(pull)} />
          </span>
        ))}
        <small className="board-card-activity">
          {account ? `${account.name}, ` : ''}
          {timeAgo(session?.updatedAt ?? task.updatedAt)}
        </small>
        <div className="board-card-actions">
          {isLive ? (
            <button className="quiet" disabled={busy} aria-label={`Stop session of ${title}`} title="Stop session" onClick={onStop}>
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            !isDone && (
              <button
                className="quiet"
                disabled={busy}
                aria-label={`${session ? 'Resume session of' : 'Start session of'} ${title}`}
                title={session ? 'Resume session' : 'Start session'}
                onClick={() => onMove('working')}
              >
                <Play size={13} />
              </button>
            )
          )}
          {task.isolated && worktree && (
            <button className="quiet" disabled={busy} aria-label={`Open copies of ${title} in the editor`} title="Open in the editor" onClick={onOpenInEditor}>
              <ExternalLink size={13} />
            </button>
          )}
          {readyToClose ? (
            <button className="quiet close-ready" disabled={busy} aria-label={`Close ${title}`} title="Close this task" onClick={() => onMove('done')}>
              <Check size={13} />
            </button>
          ) : (
            !isDone &&
            !isLive && (
              <button className="quiet" disabled={busy} aria-label={`Mark ${title} done`} title="Mark done" onClick={() => onMove('done')}>
                <Check size={13} />
              </button>
            )
          )}
          <select aria-label={`Move ${title} to`} disabled={busy} value={placeOnBoard(card).lane} onChange={(event) => onMove(event.target.value as LaneId)}>
            {BOARD_LANES.map((lane) => (
              <option key={lane.id} value={lane.id}>
                {lane.title}
              </option>
            ))}
          </select>
        </div>
      </article>
    </li>
  );
}
