// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InboxPage } from '../../src/renderer/src/components/InboxPage';
import { api } from '../../src/renderer/src/lib/api';
import type { Snapshot } from '../../src/shared/api';
import { companySchema, taskSchema, type Task } from '../../src/shared/schemas';

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: { updateTask: vi.fn(async () => undefined), deleteTask: vi.fn(async () => undefined), addIdeas: vi.fn(async () => undefined), reorderTasks: vi.fn(async () => undefined) },
}));

const company = companySchema.parse({ id: 'c', name: 'Client', color: '#5BB8A6', rootDir: '/code' });
const idea = (id: string, title: string, change: Record<string, unknown> = {}): Task => taskSchema.parse({ id, companyId: 'c', title, status: 'idea', createdAt: 'x', updatedAt: 'x', ...change });
const snapshotOf = (tasks: Task[]) => ({ companies: [company], tasks }) as unknown as Snapshot;

const first = idea('one', 'Fix the login', { description: 'Staging only\nSecond line', checklist: [{ id: 'a', text: 'Reproduce', done: false }] });
const second = idea('two', 'Review the report');
const onOpenTask = vi.fn();
const onChanged = vi.fn(async () => undefined);
const details = () => screen.queryByRole('complementary', { name: 'Inbox item details' });
const show = (tasks: Task[] = [first, second]) => <InboxPage snapshot={snapshotOf(tasks)} companyId="c" onOpenTask={onOpenTask} onChanged={onChanged} />;

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('the inbox table', () => {
  it('shows each item as a row with its priority and actions', () => {
    render(show());
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3);
    const row = within(screen.getByRole('button', { name: 'Fix the login' }).closest('tr') as HTMLElement);
    expect(row.getByRole('combobox', { name: 'Priority of Fix the login' })).toBeTruthy();
    expect(row.getByRole('button', { name: 'Make it a task' })).toBeTruthy();
    expect(row.getByRole('button', { name: 'Delete Fix the login' })).toBeTruthy();
  });

  it('opens the details when a row is clicked, and closes them on a second click', async () => {
    render(show());
    await userEvent.click(screen.getByRole('button', { name: 'Fix the login' }));
    expect(within(details()!).getByLabelText('Title')).toHaveProperty('value', 'Fix the login');
    expect(within(details()!).getByLabelText('Details')).toHaveProperty('value', 'Staging only\nSecond line');
    await userEvent.click(screen.getByRole('button', { name: 'Fix the login' }));
    expect(details()).toBeNull();
  });

  it('shows the item you clicked last, without mixing up its edits', async () => {
    render(show());
    await userEvent.click(screen.getByRole('button', { name: 'Fix the login' }));
    await userEvent.type(within(details()!).getByLabelText('Details'), ' more');
    await userEvent.click(screen.getByRole('button', { name: 'Review the report' }));
    expect(within(details()!).getByLabelText('Title')).toHaveProperty('value', 'Review the report');
    expect(within(details()!).getByLabelText('Details')).toHaveProperty('value', '');
    expect(api.updateTask).toHaveBeenCalledWith('one', { title: 'Fix the login', customTitle: true, description: 'Staging only\nSecond line more' });
  });

  it('keeps the details closed when using the controls of a row', async () => {
    render(show());
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Priority of Fix the login' }), 'high');
    await userEvent.click(screen.getByRole('button', { name: 'Move Fix the login down' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete Fix the login' }));
    expect(details()).toBeNull();
    expect(api.updateTask).toHaveBeenCalledWith('one', { priority: 'high' });
  });

  it('asks before deleting', async () => {
    render(show());
    await userEvent.click(screen.getByRole('button', { name: 'Delete Fix the login' }));
    expect(api.deleteTask).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(api.deleteTask).toHaveBeenCalledWith('one');
  });

  it('makes a row a task and opens it', async () => {
    render(show());
    const row = screen.getByRole('button', { name: 'Fix the login' }).closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Make it a task' }));
    expect(api.updateTask).toHaveBeenCalledWith('one', { status: 'todo' });
    await waitFor(() => expect(onOpenTask).toHaveBeenCalledWith('one', 'c'));
  });

  it('makes a task from the details with the edits made there', async () => {
    render(show());
    await userEvent.click(screen.getByRole('button', { name: 'Review the report' }));
    await userEvent.type(within(details()!).getByLabelText('Details'), 'Known so far');
    await userEvent.click(within(details()!).getByRole('button', { name: 'Make it a task' }));
    expect(api.updateTask).toHaveBeenCalledWith('two', { title: 'Review the report', description: 'Known so far', status: 'todo' });
    await waitFor(() => expect(onOpenTask).toHaveBeenCalledWith('two', 'c'));
  });

  it('saves and closes on Escape', async () => {
    render(show());
    await userEvent.click(screen.getByRole('button', { name: 'Review the report' }));
    await userEvent.type(within(details()!).getByLabelText('Details'), 'Known so far');
    await userEvent.keyboard('{Escape}');
    expect(details()).toBeNull();
    expect(api.updateTask).toHaveBeenCalledWith('two', { title: 'Review the report', customTitle: true, description: 'Known so far' });
  });

  it('stays open on Escape while typing in the box for new work', async () => {
    render(show());
    await userEvent.click(screen.getByRole('button', { name: 'Review the report' }));
    await userEvent.click(screen.getByLabelText('Paste or write what you have in mind'));
    await userEvent.keyboard('{Escape}');
    expect(details()).not.toBeNull();
  });

  it('closes the details when the item stops being in the inbox', async () => {
    const { rerender } = render(show());
    await userEvent.click(screen.getByRole('button', { name: 'Fix the login' }));
    rerender(show([second]));
    expect(details()).toBeNull();
  });
});
