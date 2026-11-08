// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskRow } from '../../src/renderer/src/components/TaskRow';
import { TaskTable } from '../../src/renderer/src/components/TaskTable';
import type { TodayItem } from '../../src/renderer/src/lib/today';
import type { Company } from '../../src/shared/schemas';

const company = (id: string, name: string): Company => ({
  id,
  name,
  color: '#112233',
  skipPermissions: false,
  origin: 'existing', hasCode: true, confirmedSteps: [],
  protectedPaths: [], links: [],
  subdomains: [{ id: 'uploads', name: 'Uploads', description: '', folders: [], links: [] }],
  projects: [],
  context: {},
});

afterEach(cleanup);

describe('TaskRow', () => {
  const item: TodayItem = {
    company: company('a', 'Acme'),
    task: {
      isolated: false, worktrees: [], checklist: [], priority: 'none', note: '', 
      id: 't',
      companyId: 'a',
      subdomainId: 'uploads',
      title: 'Fix login',
      description: '',
      projectIds: [],
      status: 'doing',
      source: { kind: 'jira', key: 'ACME-1' },
      createdAt: '',
      updatedAt: '',
    },
    session: {
      id: 'x',
      taskId: 't',
      companyId: 'a',
      accountId: 'c',
      cwd: '/',
      state: 'needs-input',
      startedAt: '',
      updatedAt: '',
    },
  };

  const inTable = (row: ReactNode) =>
    render(
      <table>
        <tbody>{row}</tbody>
      </table>,
    );

  it('says which client it belongs to and what it needs, and opens on click', async () => {
    const onSelect = vi.fn();
    inTable(<TaskRow item={item} showClient onSelect={onSelect} />);
    expect(screen.getByText('Acme, Uploads, ACME-1, Needs your answer')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Fix login/ }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('opens when any part of the row is clicked', async () => {
    const onSelect = vi.fn();
    inTable(<TaskRow item={item} showClient={false} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('cell', { name: 'Uploads' }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('shows the priority and checklist progress in their own columns', () => {
    inTable(<TaskRow item={{ ...item, task: { ...item.task, priority: 'high', checklist: [{ id: 'a', text: 'One', done: true }, { id: 'b', text: 'Two', done: false }] } }} showClient={false} onSelect={() => undefined} />);
    expect(screen.getByRole('cell', { name: 'High' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '1 of 2 done' })).toBeTruthy();
  });

  it('leaves the priority empty when there is none', () => {
    inTable(<TaskRow item={item} showClient={false} onSelect={() => undefined} />);
    expect(screen.queryByRole('cell', { name: /priority/i })).toBeNull();
    expect(document.querySelector('td.task-col-priority')?.textContent).toBe('');
  });
});

describe('TaskTable', () => {
  const item: TodayItem = {
    company: company('a', 'Acme'),
    task: { isolated: false, worktrees: [], checklist: [], priority: 'none', note: '', id: 't', companyId: 'a', title: 'Fix login', description: '', projectIds: [], status: 'todo', createdAt: '', updatedAt: '' },
  };

  it('has a client column only when it lists more than one client', () => {
    const { rerender } = render(<TaskTable items={[item]} showClient onSelect={() => undefined} />);
    expect(screen.getByRole('columnheader', { name: 'Client' })).toBeTruthy();
    rerender(<TaskTable items={[item]} showClient={false} onSelect={() => undefined} />);
    expect(screen.queryByRole('columnheader', { name: 'Client' })).toBeNull();
  });

  it('opens the task of the row you click', async () => {
    const onSelect = vi.fn();
    render(<TaskTable items={[item]} showClient={false} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: /Fix login/ }));
    expect(onSelect).toHaveBeenCalledWith('t');
  });
});
