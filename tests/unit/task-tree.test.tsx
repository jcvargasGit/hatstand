// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskTree } from '../../src/renderer/src/components/TaskTree';
import type { TodayItem } from '../../src/renderer/src/lib/today';
import { companySchema, taskSchema } from '../../src/shared/schemas';

afterEach(cleanup);

const company = companySchema.parse({ id: 'acme', name: 'Acme', color: '#5BB8A6' });
const item = (id: string, playbookId?: string, name?: string): TodayItem => ({
  company,
  task: taskSchema.parse({
    id,
    companyId: 'acme',
    title: `Task ${id}`,
    status: 'todo',
    createdAt: 'x',
    updatedAt: 'x',
    ...(playbookId ? { guide: { playbookId, name, current: 0, promptPending: false, done: [], steps: [{ name: 'One', prompt: 'a' }] } } : {}),
  }),
});
const items = [item('a', 'rfc', 'Write an RFC'), item('b')];

const renderTree = (change: Partial<Parameters<typeof TaskTree>[0]> = {}) => {
  const props = { label: 'Acme open tasks', items, selectedTaskId: null, closed: [], onToggle: vi.fn(), onSelect: vi.fn(), onMenu: vi.fn(), onAddTask: vi.fn(), ...change };
  render(<TaskTree {...props} />);
  return props;
};

describe('the guides in the sidebar tree', () => {
  it('starts a task with the guide of the group, without folding it', async () => {
    const { onAddTask, onToggle } = renderTree();
    await userEvent.click(screen.getByRole('button', { name: 'New task with Write an RFC, in Acme open tasks' }));
    expect(onAddTask).toHaveBeenCalledWith('rfc');
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByText('Task a')).toBeTruthy();
  });

  it('starts a task with no guide from the tasks with no guide', async () => {
    const { onAddTask } = renderTree();
    await userEvent.click(screen.getByRole('button', { name: 'New task with no guide, in Acme open tasks' }));
    expect(onAddTask).toHaveBeenCalledWith('');
  });

  it('keeps the button of a folded guide', () => {
    renderTree({ closed: ['Acme open tasks:guide:rfc'] });
    expect(screen.queryByText('Task a')).toBeNull();
    expect(screen.getByRole('button', { name: 'New task with Write an RFC, in Acme open tasks' })).toBeTruthy();
  });

  it('has no button where tasks cannot be added', () => {
    renderTree({ onAddTask: undefined });
    expect(screen.queryByRole('button', { name: /New task/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Write an RFC/ }).getAttribute('aria-expanded')).toBe('true');
  });
});
