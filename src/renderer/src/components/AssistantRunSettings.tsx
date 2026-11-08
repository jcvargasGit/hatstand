import { assistantRunOf, assistantStopSchema, type Company } from '../../../shared/schemas';
import { STOP_AT_NAMES } from '../lib/assistant-run';

const PARALLEL_CHOICES = [1, 2, 3, 4, 5];

type AssistantRunSettingsProps = {
  company: Company;
  onSave: (company: Company) => Promise<void>;
};

export function AssistantRunSettings({ company, onSave }: AssistantRunSettingsProps) {
  const run = assistantRunOf(company);
  return (
    <fieldset className="field-block assistant-run-settings">
      <h3>Run with assistant</h3>
      <p className="hint">Defaults for running this client&rsquo;s inbox with the assistant. For now the assistant only proposes a plan.</p>
      <label>
        Tasks at a time
        <select value={run.parallel} onChange={(event) => void onSave({ ...company, assistantRun: { ...run, parallel: Number(event.target.value) } })}>
          {PARALLEL_CHOICES.map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </select>
      </label>
      <label>
        Stop at
        <select
          value={run.stopAt}
          onChange={(event) => void onSave({ ...company, assistantRun: { ...run, stopAt: assistantStopSchema.parse(event.target.value) } })}
        >
          {assistantStopSchema.options.map((stop) => (
            <option key={stop} value={stop}>
              {STOP_AT_NAMES[stop]}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}
