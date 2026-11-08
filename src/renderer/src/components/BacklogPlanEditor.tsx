import { ArrowDown, ArrowUp, CircleHelp, ListOrdered, Plus, Trash2, X } from 'lucide-react';
import { planItemName, type BacklogPlan, type PlanItem } from '../../../shared/backlog-plan';
import { addGroup, bringIntoOrder, changeGroup, changeOutOfScope, changeStep, leaveOutOfScope, moveStep, removeGroup } from '../lib/backlog-plan-edit';

type TaskChipsProps = {
  caption: string;
  ids: number[];
  choices: number[];
  items: PlanItem[];
  placeholder: string;
  addLabel: string;
  removeLabel: (name: string) => string;
  onChange: (ids: number[]) => void;
};

function TaskChips({ caption, ids, choices, items, placeholder, addLabel, removeLabel, onChange }: TaskChipsProps) {
  const name = (id: number) => planItemName(items, id);
  const available = choices.filter((id) => !ids.includes(id));
  if (ids.length === 0 && available.length === 0) return null;
  return (
    <div className="plan-chips">
      <span className="hint">{caption}</span>
      {ids.length > 0 && (
        <ul className="chips">
          {ids.map((id) => (
            <li key={id}>
              {name(id)}
              <button className="chip-remove" aria-label={removeLabel(name(id))} title="Remove" onClick={() => onChange(ids.filter((item) => item !== id))}>
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 && (
        <select aria-label={addLabel} value="" onChange={(event) => event.target.value && onChange([...ids, Number(event.target.value)])}>
          <option value="">{placeholder}</option>
          {available.map((id) => (
            <option key={id} value={id}>
              {name(id)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

type BacklogPlanEditorProps = {
  plan: BacklogPlan;
  items: PlanItem[];
  onChange: (plan: BacklogPlan) => void;
};

export function BacklogPlanEditor({ plan, items, onChange }: BacklogPlanEditorProps) {
  const name = (task: number) => planItemName(items, task);
  const ordered = plan.order.map((step) => step.task);

  return (
    <div className="plan-editor">
      <label className="plan-field">
        Summary
        <textarea rows={3} value={plan.summary} onChange={(event) => onChange({ ...plan, summary: event.target.value })} />
      </label>

      <section className="plan-section" aria-label="Order">
        <h4>Order</h4>
        {plan.order.length === 0 && <p className="hint">Nothing is in the order. Bring a task back from the ones waiting for your decision.</p>}
        <ol className="plan-steps">
          {plan.order.map((step, index) => (
            <li key={step.task} className="plan-step">
              <div className="plan-step-head">
                <span className="plan-step-number">{index + 1}</span>
                <strong>{name(step.task)}</strong>
                <span className="plan-step-actions">
                  <button className="quiet" aria-label={`Move ${name(step.task)} up`} title="Move up" disabled={index === 0} onClick={() => onChange(moveStep(plan, index, -1))}>
                    <ArrowUp size={14} />
                  </button>
                  <button className="quiet" aria-label={`Move ${name(step.task)} down`} title="Move down" disabled={index === plan.order.length - 1} onClick={() => onChange(moveStep(plan, index, 1))}>
                    <ArrowDown size={14} />
                  </button>
                  <button className="quiet" aria-label={`${name(step.task)} needs a decision`} title="Leave it out of this plan until you decide" onClick={() => onChange(leaveOutOfScope(plan, step.task))}>
                    <CircleHelp size={14} />
                    Needs a decision
                  </button>
                </span>
              </div>
              <input aria-label={`Why ${name(step.task)} goes here`} placeholder="Why it goes here" value={step.reason} onChange={(event) => onChange(changeStep(plan, step.task, { reason: event.target.value }))} />
              <TaskChips
                caption="Waits for"
                ids={step.dependsOn}
                choices={ordered.filter((task) => task !== step.task)}
                items={items}
                placeholder={step.dependsOn.length === 0 ? 'Nothing. Add a task' : 'Add a task'}
                addLabel={`Add a task ${name(step.task)} waits for`}
                removeLabel={(other) => `${name(step.task)} no longer waits for ${other}`}
                onChange={(dependsOn) => onChange(changeStep(plan, step.task, { dependsOn }))}
              />
            </li>
          ))}
        </ol>
      </section>

      <section className="plan-section" aria-label="Not at the same time">
        <h4>Not at the same time</h4>
        {plan.notInParallel.length === 0 && <p className="hint">Every task in the order can be developed alongside the others.</p>}
        <ul className="plan-groups">
          {plan.notInParallel.map((group, index) => (
            <li key={index} className="plan-group">
              <TaskChips
                caption="Tasks"
                ids={group.tasks}
                choices={ordered}
                items={items}
                placeholder="Add a task"
                addLabel={`Add a task to group ${index + 1}`}
                removeLabel={(other) => `Remove ${other} from group ${index + 1}`}
                onChange={(tasks) => onChange(changeGroup(plan, index, { tasks }))}
              />
              <div className="plan-group-row">
                <input aria-label={`Why group ${index + 1} cannot run at the same time`} placeholder="Why, such as the same files or the same migration" value={group.reason} onChange={(event) => onChange(changeGroup(plan, index, { reason: event.target.value }))} />
                <button className="quiet" aria-label={`Remove group ${index + 1}`} title="Remove group" onClick={() => onChange(removeGroup(plan, index))}>
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
        {ordered.length >= 2 && (
          <button className="quiet plan-add" onClick={() => onChange(addGroup(plan))}>
            <Plus size={14} />
            Add a group
          </button>
        )}
      </section>

      <section className="plan-section" aria-label="Needs your decision first">
        <h4>Needs your decision first</h4>
        {plan.outOfScope.length === 0 && <p className="hint">No task waits for a decision.</p>}
        <ul className="plan-groups">
          {plan.outOfScope.map((item) => (
            <li key={item.task} className="plan-group">
              <div className="plan-step-head">
                <strong>{name(item.task)}</strong>
                <span className="plan-step-actions">
                  <button className="quiet" aria-label={`Bring ${name(item.task)} back to the order`} onClick={() => onChange(bringIntoOrder(plan, item.task))}>
                    <ListOrdered size={14} />
                    Back to the order
                  </button>
                </span>
              </div>
              <input aria-label={`Decision needed for ${name(item.task)}`} placeholder="What you have to decide" value={item.decisionNeeded} onChange={(event) => onChange(changeOutOfScope(plan, item.task, { decisionNeeded: event.target.value }))} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
