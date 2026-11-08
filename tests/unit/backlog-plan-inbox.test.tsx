// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InboxPage } from '../../src/renderer/src/components/InboxPage';
import { api } from '../../src/renderer/src/lib/api';
import type { Snapshot } from '../../src/shared/api';
import { companySchema, taskSchema, type Task } from '../../src/shared/schemas';

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: {
    updateTask: vi.fn(async () => undefined),
    deleteTask: vi.fn(async () => undefined),
    addIdeas: vi.fn(async () => undefined),
    reorderTasks: vi.fn(async () => undefined),
    planBacklog: vi.fn(async () => ({ id: 'plan' })),
    startSession: vi.fn(async () => undefined),
  },
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

const acme = companySchema.parse({ id: 'acme', name: 'Acme', color: '#5BB8A6', rootDir: '/code' });
const labs = companySchema.parse({ id: 'labs', name: 'Labs', color: '#E0A04E' });
const idea = (id: string, companyId: string, title: string, rank: number, change: Record<string, unknown> = {}): Task =>
  taskSchema.parse({ id, companyId, title, status: 'idea', rank, createdAt: 'x', updatedAt: 'x', ...change });
const tasks = [idea('a1', 'acme', 'Add the export', 0, { priority: 'high' }), idea('a2', 'acme', 'Send it by email', 1), idea('a3', 'acme', 'Pick a library', 2), idea('b1', 'labs', 'Close the month', 0)];
const snapshot = { companies: [acme, labs], tasks } as unknown as Snapshot;
const onOpenTask = vi.fn();
const onChanged = vi.fn(async () => undefined);
const group = (name: string) => within(screen.getByRole('region', { name: `${name} inbox` }));
const runButton = (name: string) => group(name).getByRole<HTMLButtonElement>('button', { name: 'Run with assistant' });
const confirmRun = async (name: string) => {
  await userEvent.click(runButton(name));
  await userEvent.click(group(name).getByRole('button', { name: 'Create the plan' }));
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('running inbox tasks with the assistant', () => {
  it('gives each client its own button, beside sorting by priority, that waits for a selection', () => {
    render(<InboxPage snapshot={snapshot} companyId={null} onOpenTask={onOpenTask} onChanged={onChanged} />);
    expect(runButton('Acme').disabled).toBe(true);
    expect(runButton('Labs').disabled).toBe(true);
    const actions = runButton('Acme').parentElement as HTMLElement;
    expect(within(actions).getByRole('button', { name: 'Sort by priority' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Run with assistant' })).toHaveLength(2);
  });

  it('sends only the selected tasks of that client, in inbox order, then starts the session and opens the plan', async () => {
    render(<InboxPage snapshot={snapshot} companyId={null} onOpenTask={onOpenTask} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Pick a library' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Add the export' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Close the month' }));
    expect(group('Acme').getByText('2 selected')).toBeTruthy();

    await confirmRun('Acme');
    expect(api.planBacklog).toHaveBeenCalledExactlyOnceWith('acme', ['a1', 'a3']);
    await waitFor(() => expect(onOpenTask).toHaveBeenCalledWith('plan', 'acme'));
    expect(api.startSession).toHaveBeenCalledWith('plan');
    const [started] = vi.mocked(api.startSession).mock.invocationCallOrder;
    const [refreshed] = onChanged.mock.invocationCallOrder;
    const [opened] = onOpenTask.mock.invocationCallOrder;
    expect(started! < refreshed! && refreshed! < opened!).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select Add the export' }).checked).toBe(false);
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select Close the month' }).checked).toBe(true);
  });

  it('selects every task of a client at once', async () => {
    render(<InboxPage snapshot={snapshot} companyId={null} onOpenTask={onOpenTask} onChanged={onChanged} />);
    const all = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select every task of Acme' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Add the export' }));
    expect(all.indeterminate).toBe(true);
    await userEvent.click(all);
    expect(group('Acme').getByText('3 selected')).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select Close the month' }).checked).toBe(false);
    await userEvent.click(all);
    expect(runButton('Acme').disabled).toBe(true);
  });

  it('does not open the details of a row when its box is ticked', async () => {
    render(<InboxPage snapshot={snapshot} companyId="acme" onOpenTask={onOpenTask} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Add the export' }));
    expect(screen.queryByRole('complementary', { name: 'Inbox item details' })).toBeNull();
  });

  it('opens the plan without a session when the client has nowhere to work yet', async () => {
    render(<InboxPage snapshot={snapshot} companyId={null} onOpenTask={onOpenTask} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Close the month' }));
    await confirmRun('Labs');
    await waitFor(() => expect(onOpenTask).toHaveBeenCalledWith('plan', 'labs'));
    expect(api.startSession).not.toHaveBeenCalled();
  });

  it('says so when the session does not start, and still leads to the planning task', async () => {
    vi.mocked(api.startSession).mockRejectedValueOnce(new Error('claude was not found on your PATH.'));
    render(<InboxPage snapshot={snapshot} companyId="acme" onOpenTask={onOpenTask} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Add the export' }));
    await confirmRun('Acme');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Hatstand created the planning task, but its session did not start: claude was not found on your PATH.');
    expect(onOpenTask).not.toHaveBeenCalled();
    await userEvent.click(within(alert).getByRole('button', { name: 'Open the planning task' }));
    expect(onOpenTask).toHaveBeenCalledWith('plan', 'acme');
  });

  it('asks first, showing the client defaults, and creates nothing when cancelled', async () => {
    render(<InboxPage snapshot={snapshot} companyId="acme" onOpenTask={onOpenTask} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Add the export' }));
    await userEvent.click(runButton('Acme'));
    const confirm = screen.getByRole('group', { name: 'Run Acme tasks with the assistant' });
    expect(confirm.textContent).toContain('2 tasks at a time, stop at the commit');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'Run Acme tasks with the assistant' })).toBeNull();
    expect(api.planBacklog).not.toHaveBeenCalled();
  });

  it('shows the defaults saved in the client settings', async () => {
    const custom = companySchema.parse({ ...acme, assistantRun: { parallel: 3, stopAt: 'pull-request' } });
    render(<InboxPage snapshot={{ ...snapshot, companies: [custom, labs] }} companyId="acme" onOpenTask={onOpenTask} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Add the export' }));
    await userEvent.click(runButton('Acme'));
    expect(screen.getByRole('group', { name: 'Run Acme tasks with the assistant' }).textContent).toContain('3 tasks at a time, stop at the pull request');
  });

  it('warns that a run would stop at every permission prompt, without turning permissions off', async () => {
    render(<InboxPage snapshot={snapshot} companyId="acme" onOpenTask={onOpenTask} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Add the export' }));
    await userEvent.click(runButton('Acme'));
    expect(screen.getByRole('note').textContent).toContain('would stop at every permission prompt');
    await userEvent.click(screen.getByRole('button', { name: 'Create the plan' }));
    await waitFor(() => expect(onOpenTask).toHaveBeenCalled());
    expect(api.updateTask).not.toHaveBeenCalled();
    expect(acme.skipPermissions).toBe(false);
  });

  it('does not warn when the client already lets agents act without asking', async () => {
    const trusted = companySchema.parse({ ...acme, skipPermissions: true });
    render(<InboxPage snapshot={{ ...snapshot, companies: [trusted, labs] }} companyId="acme" onOpenTask={onOpenTask} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Add the export' }));
    await userEvent.click(runButton('Acme'));
    expect(screen.queryByRole('note')).toBeNull();
  });
});
