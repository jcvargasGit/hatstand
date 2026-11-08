import { Sparkles } from 'lucide-react';
import { assistantRunOf, type Company } from '../../../shared/schemas';
import { assistantRunSummary } from '../lib/assistant-run';
import { plural } from '../lib/text';

type AssistantRunConfirmProps = {
  company: Company;
  count: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function AssistantRunConfirm({ company, count, busy, onConfirm, onCancel }: AssistantRunConfirmProps) {
  return (
    <div className="warning assistant-run-confirm" role="group" aria-label={`Run ${company.name} tasks with the assistant`}>
      <p>
        The assistant reads {plural(count, 'selected task', 'selected tasks')} and proposes a plan in a new planning task: the order, the dependencies, what cannot run at the
        same time, and what needs your decision first. It does not change code, and approving the plan starts nothing.
      </p>
      <p className="hint">Defaults for a run of this client: {assistantRunSummary(assistantRunOf(company))}. Change them in the client&rsquo;s settings.</p>
      {!company.skipPermissions && (
        <p className="warning-text" role="note">
          Agents of this client ask for permission. A run would stop at every permission prompt until you answer it. Hatstand does not change this setting.
        </p>
      )}
      <div className="inline-form">
        <button disabled={busy} onClick={onConfirm}>
          <Sparkles size={14} />
          Create the plan
        </button>
        <button className="quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
