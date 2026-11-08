import { useState, type FormEvent } from 'react';
import { workPeriodSchema, type WorkPeriod } from '../../../shared/schemas';
import { describePeriod } from '../../../shared/work-periods';

type WorkPeriodFormProps = {
  period: WorkPeriod;
  busy: boolean;
  onSave: (period: WorkPeriod) => void;
};

export function WorkPeriodForm({ period, busy, onSave }: WorkPeriodFormProps) {
  const [every, setEvery] = useState(String(period.every));
  const [unit, setUnit] = useState(period.unit);
  const [startsOn, setStartsOn] = useState(period.startsOn);
  const [error, setError] = useState<string | null>(null);
  const unchanged = every === String(period.every) && unit === period.unit && startsOn === period.startsOn;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = workPeriodSchema.safeParse({ every: Number(every), unit, startsOn });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the period.');
      return;
    }
    setError(null);
    onSave(parsed.data);
  };

  return (
    <form className="work-period" aria-label="Work period" noValidate onSubmit={submit}>
      <label>
        Every
        <input type="number" min={1} max={366} value={every} onChange={(event) => setEvery(event.target.value)} />
      </label>
      <label>
        Unit
        <select value={unit} onChange={(event) => setUnit(workPeriodSchema.shape.unit.parse(event.target.value))}>
          <option value="days">days</option>
          <option value="weeks">weeks</option>
          <option value="months">months</option>
        </select>
      </label>
      <label>
        First period starts on
        <input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
      </label>
      <button type="submit" className="quiet" disabled={busy || unchanged}>
        Save period
      </button>
      <small className="hint">{describePeriod(period)} for this client. Months are calendar months.</small>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
