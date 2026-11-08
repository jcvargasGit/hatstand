import { ChevronDown, ChevronRight, RefreshCw, Send } from 'lucide-react';
import { useState } from 'react';
import { pullChips } from '../../../shared/review';
import type { PullRequest, Task, TaskReview } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { PullChips } from './PullChips';

type TaskPullRequestsProps = {
  task: Task;
  review?: TaskReview;
  onChanged: () => Promise<void>;
  onGiven?: () => void;
};

function PullDetails({ pull }: { pull: PullRequest }) {
  return (
    <div className="pull-details">
      {pull.failedChecks.length > 0 && (
        <>
          <h4>Failed checks</h4>
          <ul>
            {pull.failedChecks.map((check) => (
              <li key={check.name}>
                {check.url ? (
                  <a href={check.url} target="_blank" rel="noreferrer">
                    {check.name}
                  </a>
                ) : (
                  check.name
                )}
                {check.detail && <p className="pull-text">{check.detail}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
      {pull.comments.length > 0 && (
        <>
          <h4>Comments not resolved</h4>
          <ul>
            {pull.comments.map((comment) => (
              <li key={comment.id}>
                <strong>{comment.author}</strong>
                {comment.file && (
                  <span className="hint">
                    {' '}
                    {comment.file}
                    {comment.line ? `:${comment.line}` : ''}
                  </span>
                )}
                <p className="pull-text">{comment.body}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function TaskPullRequests({ task, review, onChanged, onGiven }: TaskPullRequestsProps) {
  const [open, setOpen] = useState(false);
  const { error, busy, run } = useAction();
  const hasCode = task.isolated && task.worktrees.length > 0;
  if (!hasCode || !review || (review.pulls.length === 0 && !review.error)) return null;

  const hasDetails = review.pulls.some((pull) => pull.failedChecks.length > 0 || pull.comments.length > 0);
  const alreadyGiven = review.feedbackKey !== undefined && task.feedbackSent === review.feedbackKey;

  return (
    <div className="task-pulls" aria-label="Pull requests">
      {review.pulls.map((pull) => (
        <p key={`${pull.projectId}-${pull.number}`} className="task-pull">
          <a href={pull.url} target="_blank" rel="noreferrer" title={pull.title}>
            {pull.repo} #{pull.number}
          </a>
          <PullChips chips={pullChips(pull)} />
        </p>
      ))}
      <div className="task-pulls-actions">
        {review.feedbackKey && (
          <button
            className={alreadyGiven ? 'quiet' : undefined}
            disabled={busy}
            title="Saves the CI failures and comments to a private file, and writes a prompt for the agent. You press Enter to send it."
            onClick={() =>
              void run(async () => {
                await api.giveFeedbackToAgent(task.id);
                await onChanged();
                onGiven?.();
              })
            }
          >
            <Send size={14} />
            {alreadyGiven ? 'Give it to the agent again' : 'Give this to the agent'}
          </button>
        )}
        {hasDetails && (
          <button className="quiet" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Details
          </button>
        )}
        <button
          className="quiet"
          disabled={busy}
          aria-label="Refresh pull requests"
          title="Refresh pull requests"
          onClick={() =>
            void run(async () => {
              await api.refreshReviews(task.id);
              await onChanged();
            })
          }
        >
          <RefreshCw size={14} />
        </button>
      </div>
      {alreadyGiven && <p className="hint">The agent has this feedback. Press Enter in the terminal if the prompt is still waiting there.</p>}
      {review.error && <p className="hint">{review.error}</p>}
      {error && <p className="error">{error}</p>}
      {open && review.pulls.map((pull) => <PullDetails key={`${pull.projectId}-${pull.number}`} pull={pull} />)}
    </div>
  );
}
