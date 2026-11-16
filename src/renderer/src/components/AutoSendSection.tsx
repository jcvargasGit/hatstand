import { SendHorizontal } from 'lucide-react';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';

type AutoSendSectionProps = {
  enabled: boolean;
  onChanged: () => Promise<void>;
};

export function AutoSendSection({ enabled, onChanged }: AutoSendSectionProps) {
  const { error, busy, run } = useAction();

  const change = (next: boolean) =>
    run(async () => {
      await api.setAutoSendPrompt(next);
      await onChanged();
    });

  return (
    <section className="settings-section stacked" aria-labelledby="settings-auto-send">
      <h2 id="settings-auto-send">
        <SendHorizontal size={17} />
        First prompt
      </h2>
      <label className="check">
        <input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => void change(event.target.checked)} />
        <span>Send the first prompt of a task without waiting for Enter</span>
      </label>
      <p className="hint">On: the agent starts working as soon as the first session of a task opens, also after you answer its question about trusting the folder. Off: the prompt is written and waits for you to press Enter. A step that needs your approval always waits.</p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
