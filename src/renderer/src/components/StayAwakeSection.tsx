import { Sun } from 'lucide-react';
import type { StayAwakeMode } from '../../../shared/schemas';
import { useStayAwake } from '../hooks/useStayAwake';

const CHOICES: { mode: StayAwakeMode; label: string }[] = [
  { mode: 'off', label: 'Off, follow this computer’s settings' },
  { mode: 'sessions', label: 'While a session is running' },
  { mode: 'always', label: 'While Hatstand is open' },
];

export function StayAwakeSection() {
  const { status, setMode } = useStayAwake();
  return (
    <section className="settings-section stacked" aria-labelledby="settings-awake">
      <h2 id="settings-awake">
        <Sun size={17} />
        Stay awake
      </h2>
      <label>
        Keep this computer awake and the screen unlocked
        <select value={status?.mode ?? 'off'} onChange={(event) => void setMode(event.target.value as StayAwakeMode)}>
          {CHOICES.map((choice) => (
            <option key={choice.mode} value={choice.mode}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">{status?.active ? 'Keeping this computer awake now. ' : ''}Closing the lid, locking the screen yourself, or a company security policy can still put it to sleep.</p>
    </section>
  );
}
