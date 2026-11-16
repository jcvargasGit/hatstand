import { isGuideStepDone } from '../../../shared/guide-progress';
import type { Task, TaskGuide } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';

type GuideStepSelectProps = {
  task: Task;
  guide: TaskGuide;
  onChanged: () => Promise<void>;
};

/** The step of the guide the task is on. Choosing another one writes its prompt when a session runs. */
export function GuideStepSelect({ task, guide, onChanged }: GuideStepSelectProps) {
  const { error, busy, run } = useAction();
  return (
    <label className="stacked-field">
      Current step
      <select
        value={guide.current}
        disabled={busy || task.status === 'done' || task.archivedAt !== undefined}
        onChange={(event) =>
          void run(async () => {
            await api.moveGuideStep(task.id, Number(event.target.value));
            await onChanged();
          })
        }
      >
        {guide.steps.map((step, index) => (
          <option key={`${index}-${step.name}`} value={index}>
            {index + 1}. {step.name}
            {isGuideStepDone(guide, index) ? ' (finished)' : ''}
          </option>
        ))}
      </select>
      {error && <small className="error">{error}</small>}
    </label>
  );
}
