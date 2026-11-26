import type { ChatAnswer, RelatedTask } from '../../../shared/backlog-chat';
import { TASK_STATUS_WORDS } from '../../../shared/task-status-words';
import { MarkdownView } from './MarkdownView';

type BacklogChatMessageProps = {
  question: string;
  /** Missing while the agent is still answering. */
  answer?: ChatAnswer;
  onOpenTask: (task: RelatedTask) => void;
};

const statusOf = (task: RelatedTask) => `${TASK_STATUS_WORDS[task.status]}${task.archived ? ', archived' : ''}`;

export function BacklogChatMessage({ question, answer, onOpenTask }: BacklogChatMessageProps) {
  return (
    <li className="backlog-chat-turn motion-enter">
      <p className="backlog-chat-question">{question}</p>
      {answer ? (
        <div className="backlog-chat-answer">
          <MarkdownView text={answer.answer} />
          {answer.related.length > 0 && (
            <ul className="backlog-chat-related" aria-label="Related tasks">
              {answer.related.map((task) => (
                <li key={task.taskId}>
                  <button type="button" className="quiet" onClick={() => onOpenTask(task)}>
                    {task.number !== undefined && <span className="hint">#{task.number}</span>}
                    <span className="backlog-chat-related-title">{task.title}</span>
                    <span className={`backlog-chat-status is-${task.status}`}>{statusOf(task)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="backlog-chat-answer" role="status" aria-label="The agent is reading the tasks">
          <div className="skeleton skeleton-text" />
          <div className="skeleton skeleton-text backlog-chat-skeleton-short" />
        </div>
      )}
    </li>
  );
}
