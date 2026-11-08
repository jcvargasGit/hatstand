import { ListChecks } from 'lucide-react';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';

type NewTasksSectionProps = {
  enabled: boolean;
  onChanged: () => Promise<void>;
};

export function NewTasksSection({ enabled, onChanged }: NewTasksSectionProps) {
  const { error, busy, run } = useAction();

  const change = (next: boolean) =>
    run(async () => {
      await api.setGuideNewTasks(next);
      await onChanged();
    });

  return (
    <section className="settings-section stacked" aria-labelledby="settings-new-tasks">
      <h2 id="settings-new-tasks">
        <ListChecks size={17} />
        New tasks
      </h2>
      <label className="check">
        <input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => void change(event.target.checked)} />
        <span>Start with the guide Implement a task</span>
      </label>
      <p className="hint">On: in a client with repositories, the agent opens on the first step of the guide. Off: new tasks have no guide, and the agent starts by reviewing the task. A client&rsquo;s default guide goes first either way, and you can still choose a guide on any task.</p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
