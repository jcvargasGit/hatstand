// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TodayPage } from '../../src/renderer/src/components/TodayPage';
import type { Snapshot } from '../../src/shared/api';
import { companySchema } from '../../src/shared/schemas';

beforeEach(() => {
  vi.stubGlobal('hatstand', { invoke: () => new Promise(() => undefined), on: () => () => undefined });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const company = companySchema.parse({ id: 'acme', name: 'Acme', color: '#5BB8A6', rootDir: '/code' });

const snapshot = (todayLayout: Snapshot['todayLayout']): Snapshot => ({
  companies: [company],
  accounts: { accounts: [] },
  tasks: [],
  sessions: [],
  reviews: {},
  todayLayout,
  guideNewTasks: true,
  localKnowledge: [],
  localPlugin: [],
  starterInstructions: [],
  clientFolders: {},
});

const renderPage = (todayLayout: Snapshot['todayLayout'], companyId: string | null) => {
  const onNewTask = vi.fn();
  render(
    <TodayPage
      snapshot={snapshot(todayLayout)}
      companyId={companyId}
      onSelectTask={vi.fn()}
      onOpenClient={vi.fn()}
      onOpenInbox={vi.fn()}
      onOpenClosed={vi.fn()}
      onNewTask={onNewTask}
      onChanged={vi.fn()}
    />,
  );
  return onNewTask;
};

describe('adding a task from the tasks of a client', () => {
  it.each(['list', 'board'] as const)('offers New task in the %s, even with no tasks', async (todayLayout) => {
    const onNewTask = renderPage(todayLayout, 'acme');
    await userEvent.click(screen.getByRole('button', { name: 'New task' }));
    expect(onNewTask).toHaveBeenCalledOnce();
  });

  it('offers it in the view of all clients too', () => {
    renderPage('board', null);
    expect(screen.getByRole('button', { name: 'New task' })).toBeTruthy();
  });
});
