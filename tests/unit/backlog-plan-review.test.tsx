// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BacklogPlanReview } from '../../src/renderer/src/components/BacklogPlanReview';
import type { BacklogPlanReport, Bridge } from '../../src/shared/api';
import type { BacklogPlan } from '../../src/shared/backlog-plan';
import { companySchema, taskSchema, type Task } from '../../src/shared/schemas';

const task = (id: string, number: number, title: string, change: Record<string, unknown> = {}): Task =>
  taskSchema.parse({ id, number, companyId: 'acme', title, status: 'idea', createdAt: 'x', updatedAt: 'x', ...change });
const items = [task('a', 1, 'Add the export'), task('b', 2, 'Send it by email'), task('c', 3, 'Pick a library')];
const planning = task('p', 4, 'Plan the backlog: 3 tasks', { status: 'todo', type: 'planning', backlogPlan: { items: [{ id: 'a', number: 1 }, { id: 'b', number: 2 }, { id: 'c', number: 3 }] } });

const acme = companySchema.parse({ id: 'acme', name: 'Acme', color: '#5BB8A6' });

const plan: BacklogPlan = {
  version: 1,
  summary: 'Export first, then email.',
  order: [
    { task: 1, reason: 'Everything builds on it.', dependsOn: [] },
    { task: 2, reason: 'Uses the export.', dependsOn: [1] },
  ],
  notInParallel: [{ tasks: [1, 2], reason: 'Both change the report service.' }],
  outOfScope: [{ task: 3, decisionNeeded: 'Which PDF library is allowed?' }],
};
const valid = (change: Partial<Extract<BacklogPlanReport, { state: 'valid' }>> = {}): BacklogPlanReport => ({ state: 'valid', plan, approvedAt: null, changedAfterApproval: false, ...change });

function open(report: BacklogPlanReport, answers: Record<string, unknown> = {}) {
  const invoke = vi.fn(async (method: string, ..._args: unknown[]) => (method in answers ? answers[method] : method === 'readBacklogPlan' ? report : null));
  window.hatstand = { invoke, on: () => () => {} } as unknown as Bridge;
  render(<BacklogPlanReview task={planning} company={acme} tasks={[...items, planning]} />);
  return invoke;
}

const card = () => within(screen.getByRole('region', { name: 'Backlog plan' }));

afterEach(cleanup);

describe('reviewing the plan of the assistant', () => {
  it('explains what the assistant is doing before the plan exists', async () => {
    open({ state: 'missing' });
    expect(await card().findByText('Waiting for the assistant')).toBeTruthy();
    expect(card().getByText(/reads the 3 selected tasks and proposes the order/)).toBeTruthy();
    expect(card().queryByRole('button', { name: 'Approve plan' })).toBeNull();
  });

  it('lists what to fix in a plan that fails the check, and cannot approve it', async () => {
    open({ state: 'invalid', problems: ['#3 "Pick a library" is missing.'] });
    expect(await card().findByText('#3 "Pick a library" is missing.')).toBeTruthy();
    expect(card().getByText('Needs fixing')).toBeTruthy();
    expect(card().queryByRole('button', { name: 'Approve plan' })).toBeNull();
  });

  it('shows the order, the dependencies, what cannot run together and what needs a decision', async () => {
    open(valid());
    const order = within(await card().findByRole('region', { name: 'Order' }));
    expect(order.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['#1 Add the exportEverything builds on it.', '#2 Send it by email after #1 Add the exportUses the export.']);
    expect(within(card().getByRole('region', { name: 'Not at the same time' })).getByText('#1 Add the export, #2 Send it by email')).toBeTruthy();
    expect(within(card().getByRole('region', { name: 'Needs your decision first' })).getByText('Which PDF library is allowed?')).toBeTruthy();
    expect(card().getByText('Approving records that you reviewed this plan. It does not start any work.')).toBeTruthy();
  });

  it('approves the plan, and can withdraw the approval', async () => {
    const invoke = open(valid(), { setBacklogPlanApproval: valid({ approvedAt: '2026-11-06T10:00:00.000Z' }) });
    await userEvent.click(await card().findByRole('button', { name: 'Approve plan' }));
    expect(invoke).toHaveBeenCalledWith('setBacklogPlanApproval', 'p', true);
    expect(invoke.mock.calls.map(([method]) => method).filter((method) => method !== 'readBacklogPlan')).toEqual(['setBacklogPlanApproval']);
    expect(card().getByText('Approved')).toBeTruthy();
    expect(card().getByText(/Approval records your review\. It does not start any work\./)).toBeTruthy();
    expect(card().getByRole('button', { name: 'Withdraw approval' })).toBeTruthy();
  });

  it('shows the run defaults of the client and warns when agents ask for permission', async () => {
    open(valid());
    expect(await card().findByText(/2 tasks at a time, stop at the commit/)).toBeTruthy();
    expect(card().getByText(/would stop at every permission prompt/)).toBeTruthy();
  });

  it('warns when the plan changed after the approval', async () => {
    open(valid({ changedAfterApproval: true }));
    expect(await card().findByText('The plan changed after you approved it. Review it and approve it again.')).toBeTruthy();
    expect(card().getByRole('button', { name: 'Approve plan' })).toBeTruthy();
  });

  it('checks each edit as you make it, and saves only a plan that passes', async () => {
    const invoke = open(valid(), { saveBacklogPlan: valid() });
    await userEvent.click(await card().findByRole('button', { name: 'Edit plan' }));
    const save = card().getByRole<HTMLButtonElement>('button', { name: 'Save changes' });
    expect(save.disabled).toBe(true);

    await userEvent.click(card().getByRole('button', { name: 'Move #2 Send it by email up' }));
    const problems = card().getByRole('list', { name: 'What to fix before saving' });
    expect(problems.textContent).toContain('#2 "Send it by email" depends on #1 "Add the export", so #1 "Add the export" has to come first in the order.');
    expect(save.disabled).toBe(true);

    await userEvent.click(card().getByRole('button', { name: '#2 Send it by email no longer waits for #1 Add the export' }));
    expect(card().queryByRole('list', { name: 'What to fix before saving' })).toBeNull();
    await userEvent.type(card().getByRole('textbox', { name: 'Why #2 Send it by email goes here' }), ' Can start alone.');
    await userEvent.click(save);

    const saved = invoke.mock.calls.find(([method]) => method === 'saveBacklogPlan')?.[2] as BacklogPlan;
    expect(saved.order.map((step) => step.task)).toEqual([2, 1]);
    expect(saved.order[0]).toEqual({ task: 2, reason: 'Uses the export. Can start alone.', dependsOn: [] });
    expect(card().queryByRole('button', { name: 'Save changes' })).toBeNull();
  });

  it('leaves a task for a decision, and asks for the question', async () => {
    open(valid());
    await userEvent.click(await card().findByRole('button', { name: 'Edit plan' }));
    await userEvent.click(card().getByRole('button', { name: '#2 Send it by email needs a decision' }));
    expect(card().queryByRole('textbox', { name: 'Why group 1 cannot run at the same time' })).toBeNull();
    expect(card().getByRole('list', { name: 'What to fix before saving' }).textContent).toContain('Write the decision the person has to make.');
    await userEvent.type(card().getByRole('textbox', { name: 'Decision needed for #2 Send it by email' }), 'Which mail provider?');
    expect(card().queryByRole('list', { name: 'What to fix before saving' })).toBeNull();

    await userEvent.click(card().getByRole('button', { name: 'Bring #3 Pick a library back to the order' }));
    expect(card().getByRole('button', { name: 'Move #3 Pick a library up' })).toBeTruthy();
    await userEvent.click(card().getByRole('button', { name: 'Cancel' }));
    expect(card().getByRole('button', { name: 'Approve plan' })).toBeTruthy();
  });
});
