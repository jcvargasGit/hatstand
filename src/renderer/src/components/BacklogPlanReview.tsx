import { ClipboardCheck, Pencil, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { BacklogPlanReport } from '../../../shared/api';
import { checkBacklogPlan, planItemName, planItemsFrom, planText, type BacklogPlan, type PlanItem } from '../../../shared/backlog-plan';
import { assistantRunOf, type Company, type Task } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { useBacklogPlan } from '../hooks/useBacklogPlan';
import { api } from '../lib/api';
import { assistantRunSummary } from '../lib/assistant-run';
import { clonePlan } from '../lib/backlog-plan-edit';
import { BacklogPlanEditor } from './BacklogPlanEditor';

const NO_EXECUTION = 'Approving records that you reviewed this plan. It does not start any work.';

function planState(report: BacklogPlanReport | null): string {
  if (!report) return 'Reading the plan';
  if (report.state === 'missing') return 'Waiting for the assistant';
  if (report.state === 'invalid') return 'Needs fixing';
  if (report.approvedAt) return 'Approved';
  return report.changedAfterApproval ? 'Changed after your approval' : 'Waiting for your review';
}

function PlanView({ plan, items }: { plan: BacklogPlan; items: PlanItem[] }) {
  const name = (task: number) => planItemName(items, task);
  return (
    <div className="plan-view">
      {plan.summary && <p>{plan.summary}</p>}
      <section className="plan-section" aria-label="Order">
        <h4>Order</h4>
        {plan.order.length === 0 ? (
          <p className="hint">Nothing can be planned until you decide on the tasks below.</p>
        ) : (
          <ol className="plan-read-steps">
            {plan.order.map((step) => (
              <li key={step.task}>
                <strong>{name(step.task)}</strong>
                {step.dependsOn.length > 0 && <span className="hint"> after {step.dependsOn.map(name).join(', ')}</span>}
                {step.reason && <p className="hint">{step.reason}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
      {plan.notInParallel.length > 0 && (
        <section className="plan-section" aria-label="Not at the same time">
          <h4>Not at the same time</h4>
          <ul className="plan-read-list">
            {plan.notInParallel.map((group, index) => (
              <li key={index}>
                <strong>{group.tasks.map(name).join(', ')}</strong>
                <p className="hint">{group.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {plan.outOfScope.length > 0 && (
        <section className="plan-section" aria-label="Needs your decision first">
          <h4>Needs your decision first</h4>
          <ul className="plan-read-list">
            {plan.outOfScope.map((item) => (
              <li key={item.task}>
                <strong>{name(item.task)}</strong>
                <p>{item.decisionNeeded}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

type BacklogPlanReviewProps = {
  task: Task;
  company: Company;
  tasks: Task[];
};

export function BacklogPlanReview({ task, company, tasks }: BacklogPlanReviewProps) {
  const { report, loadError, setReport } = useBacklogPlan(task.id);
  const [draft, setDraft] = useState<BacklogPlan | null>(null);
  const [base, setBase] = useState<string | null>(null);
  const { error, busy, run } = useAction();
  const selected = task.backlogPlan?.items;
  const items = useMemo(() => planItemsFrom(selected ?? [], tasks), [selected, tasks]);
  if (!selected) return null;

  const valid = report?.state === 'valid' ? report : null;
  const check = draft ? checkBacklogPlan(draft, items) : null;
  const changed = draft !== null && planText(draft) !== base;
  const movedUnderYou = draft !== null && (valid ? planText(valid.plan) !== base : true);

  const act = (action: () => Promise<BacklogPlanReport>) =>
    run(async () => {
      setReport(await action());
    });

  const startEditing = (plan: BacklogPlan) => {
    setDraft(clonePlan(plan));
    setBase(planText(plan));
  };

  const stopEditing = () => {
    setDraft(null);
    setBase(null);
  };

  const save = () =>
    run(async () => {
      if (!draft) return;
      setReport(await api.saveBacklogPlan(task.id, draft));
      stopEditing();
    });

  return (
    <section className="overview-card overview-wide backlog-plan" aria-label="Backlog plan">
      <div className="overview-head">
        <h3>
          Backlog plan <span className={`plan-state is-${valid?.approvedAt ? 'approved' : (report?.state ?? 'loading')}`}>{planState(report)}</span>
        </h3>
      </div>

      {loadError && <p className="error">{loadError}</p>}

      {report?.state === 'missing' && (
        <p className="hint">
          The assistant reads the {selected.length === 1 ? 'selected task' : `${selected.length} selected tasks`} and proposes the order, the dependencies, what cannot be developed at the same time, and what needs your decision first. Its plan shows here. It does not change code.
        </p>
      )}

      {report?.state === 'invalid' && (
        <>
          <p>The plan file does not pass the check yet. Ask the assistant in the terminal to fix it.</p>
          <ul className="plan-problems">
            {report.problems.map((problem) => (
              <li key={problem} className="error">
                {problem}
              </li>
            ))}
          </ul>
        </>
      )}

      {valid && !draft && (
        <>
          <PlanView plan={valid.plan} items={items} />
          {valid.changedAfterApproval && <p className="warning-text">The plan changed after you approved it. Review it and approve it again.</p>}
          <p className="hint">Run defaults of this client: {assistantRunSummary(assistantRunOf(company))}.</p>
          {!company.skipPermissions && <p className="warning-text">Agents of this client ask for permission, so a run would stop at every permission prompt. Hatstand does not change this setting.</p>}
          <p className="hint">{valid.approvedAt ? `You approved this plan on ${new Date(valid.approvedAt).toLocaleString()}. Approval records your review. It does not start any work.` : NO_EXECUTION}</p>
          <div className="plan-actions">
            {valid.approvedAt ? (
              <button className="quiet" disabled={busy} onClick={() => void act(() => api.setBacklogPlanApproval(task.id, false))}>
                <Undo2 size={14} />
                Withdraw approval
              </button>
            ) : (
              <button disabled={busy} onClick={() => void act(() => api.setBacklogPlanApproval(task.id, true))}>
                <ClipboardCheck size={14} />
                Approve plan
              </button>
            )}
            <button className="quiet" disabled={busy} onClick={() => startEditing(valid.plan)}>
              <Pencil size={14} />
              Edit plan
            </button>
          </div>
        </>
      )}

      {draft && (
        <>
          {movedUnderYou && <p className="warning-text">The plan changed while you were editing it. Saving replaces that version with yours.</p>}
          <BacklogPlanEditor plan={draft} items={items} onChange={setDraft} />
          {check && !check.success && (
            <ul className="plan-problems" aria-label="What to fix before saving">
              {check.messages.map((problem) => (
                <li key={problem} className="error">
                  {problem}
                </li>
              ))}
            </ul>
          )}
          <p className="hint">Saving withdraws any approval, so you can review the new version before approving it.</p>
          <div className="plan-actions">
            <button disabled={busy || !changed || !check?.success} onClick={() => void save()}>
              Save changes
            </button>
            <button className="quiet" disabled={busy} onClick={stopEditing}>
              Cancel
            </button>
          </div>
        </>
      )}

      {error && <p className="error">{error}</p>}
    </section>
  );
}
