import type { KeyboardEvent, ReactNode } from 'react';
import type { SuggestionRequest } from '../../../shared/description-suggestion';
import { ImproveDescription } from './ImproveDescription';
import { MarkdownField } from './MarkdownField';

type TaskFormProps = {
  /** The name of the form, such as "New task". */
  label: string;
  /** The title field. Without it, the form has no title, as in the settings of a task whose title is edited above. */
  title?: { value: string; autoFocus?: boolean; onChange: (title: string) => void };
  description: string;
  improveRequest: SuggestionRequest;
  improveDisabledReason?: string;
  /** What goes under the description, such as the repositories of a task. */
  below?: ReactNode;
  /** Client, guide, area and the other settings, on the right. */
  settings: ReactNode;
  /** The buttons that create the task, fixed at the bottom right. */
  actions?: ReactNode;
  onDescriptionChange: (description: string) => void;
  onDescriptionCommit?: (description: string) => void;
  onSubmit?: () => void;
};

/**
 * One layout for writing a task: a new one, a backlog item becoming one, or the settings of an existing one.
 * The title and description take the left side, and the settings sit on the right. In a narrow panel they stack.
 */
export function TaskForm({ label, title, description, improveRequest, improveDisabledReason, below, settings, actions, onDescriptionChange, onDescriptionCommit, onSubmit }: TaskFormProps) {
  const submitOnEnter = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || !onSubmit) return;
    event.preventDefault();
    onSubmit();
  };

  return (
    <section className={actions ? 'task-form has-actions' : 'task-form'} aria-label={label}>
      <div className="task-form-grid">
        <div className="task-form-main">
          {title && (
            <input
              className="task-form-title"
              aria-label="Task title"
              autoFocus={title.autoFocus}
              placeholder="What needs doing?"
              value={title.value}
              onChange={(event) => title.onChange(event.target.value)}
              onKeyDown={submitOnEnter}
            />
          )}
          <div className="task-form-description">
            <div className="description-field-head">
              <span>Description</span>
              <ImproveDescription
                request={improveRequest}
                currentDescription={description}
                disabledReason={improveDisabledReason}
                onAccept={(text) => {
                  onDescriptionChange(text);
                  onDescriptionCommit?.(text);
                }}
              />
            </div>
            <MarkdownField
              label="Description"
              rows={14}
              placeholder="What this task is about, and what the agent should know. The agent reads it when a session starts."
              value={description}
              onChange={onDescriptionChange}
              onCommit={onDescriptionCommit}
            />
          </div>
          {below}
        </div>
        <aside className="task-form-side" aria-label="Settings of the task">
          {settings}
        </aside>
      </div>
      {actions && <footer className="task-form-actions">{actions}</footer>}
    </section>
  );
}
