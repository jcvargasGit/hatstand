// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangeClient } from '../../src/renderer/src/components/ChangeClient';
import type { Bridge } from '../../src/shared/api';
import { companySchema, taskSchema, type Company, type Session } from '../../src/shared/schemas';

const invoke = vi.fn();
const onChanged = vi.fn(async () => undefined);
const acme = companySchema.parse({ id: 'acme', name: 'Acme', color: '#5BB8A6' });
const globex = companySchema.parse({ id: 'globex', name: 'Globex', color: '#445566' });
const task = taskSchema.parse({ id: 't', number: 4, companyId: 'acme', title: 'Export invoices', status: 'todo', createdAt: 'x', updatedAt: 'x' });
const session = { taskId: 't' } as Session;

const show = (companies: Company[] = [acme, globex], sessions: Session[] = []) => render(<ChangeClient snapshot={{ companies, sessions }} task={task} onChanged={onChanged} />);
const choose = (name: string) => userEvent.selectOptions(screen.getByLabelText('Client'), name);

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ task, change: 'move' });
  onChanged.mockClear();
  window.hatstand = { invoke, on: () => () => {} } as unknown as Bridge;
});
afterEach(cleanup);

describe('changing the client of a task', () => {
  it('asks before moving a task that was not started, then moves it', async () => {
    show();
    await choose('Globex');
    expect(screen.getByRole('alert').textContent).toContain('Move to Globex? It gets a new number there');
    expect(invoke).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Move task' }));
    expect(invoke).toHaveBeenCalledExactlyOnceWith('changeTaskClient', 't', 'globex');
    expect(onChanged).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers a copy of a task that was started', async () => {
    show([acme, globex], [session]);
    await choose('Globex');
    expect(screen.getByRole('alert').textContent).toContain('already started, so it cannot be moved. Create a copy in Globex?');
    await userEvent.click(screen.getByRole('button', { name: 'Create a copy' }));
    expect(invoke).toHaveBeenCalledExactlyOnceWith('changeTaskClient', 't', 'globex');
  });

  it('changes nothing when the person cancels', async () => {
    show();
    await choose('Globex');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByLabelText<HTMLSelectElement>('Client').value).toBe('acme');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows why a move was refused, and keeps the task where it is', async () => {
    invoke.mockRejectedValue(new Error('This item is part of the backlog plan #3, so it stays with its client.'));
    show();
    await choose('Globex');
    await userEvent.click(screen.getByRole('button', { name: 'Move task' }));
    expect(await screen.findByText('This item is part of the backlog plan #3, so it stays with its client.')).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('is not shown when there is no other client to go to', () => {
    show([acme, { ...globex, archivedAt: 'now' }]);
    expect(screen.queryByLabelText('Client')).toBeNull();
  });
});
