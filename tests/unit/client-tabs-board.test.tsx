// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientTabs } from '../../src/renderer/src/components/ClientTabs';
import { moveOnBoard, placeOnBoard } from '../../src/renderer/src/lib/board';
import { taskJourney } from '../../src/renderer/src/lib/task-journey';
import { timeAgo } from '../../src/renderer/src/lib/text';
import type { TodayItem } from '../../src/renderer/src/lib/today';
import { companySchema, taskSchema, type PullRequest, type Session } from '../../src/shared/schemas';

afterEach(cleanup);

const company = companySchema.parse({ id: 'c', name: 'Client', color: '#5BB8A6', rootDir: '/code' });
const session = (state: Session['state']): Session => ({ id: 's', taskId: 't', companyId: 'c', accountId: 'a', cwd: '/x', state, startedAt: 'x', updatedAt: 'x' });
const pull: PullRequest = { projectId: 'api', repo: 'api', number: 7, title: 'Fix', url: 'https://x', state: 'open', draft: false, headSha: 'a', ci: 'passing', review: 'none', conflicts: false, failedChecks: [], comments: [] };
const item = (change: Record<string, unknown> = {}, extra: Partial<TodayItem> = {}): TodayItem => ({
  task: taskSchema.parse({ id: 't', companyId: 'c', title: 'Fix it', status: 'todo', createdAt: 'x', updatedAt: 'x', ...change }),
  company,
  ...extra,
});

describe('the sections of a client', () => {
  it('are tabs, with the backlog count and the current one marked', async () => {
    const onSelect = vi.fn();
    render(<ClientTabs company={company} active="tasks" inboxCount={3} onSelect={onSelect} />);
    expect(screen.getByRole('tab', { name: 'Tasks' }).getAttribute('aria-selected')).toBe('true');
    await userEvent.click(screen.getByRole('tab', { name: 'Backlog 3' }));
    expect(onSelect).toHaveBeenCalledWith('inbox');
  });
});

describe('moving a task on the board', () => {
  it('saves where you put it, when no agent or pull request says otherwise', () => {
    expect(moveOnBoard(item(), 'in-review')).toEqual({ kind: 'patch', patch: { status: 'doing', boardLane: 'in-review' } });
    expect(placeOnBoard(item({ boardLane: 'in-review' }))).toEqual({ lane: 'in-review', reason: 'Moved by you' });
    expect(moveOnBoard(item({ boardLane: 'in-review' }), 'next')).toEqual({ kind: 'patch', patch: { status: 'todo', boardLane: undefined } });
  });

  it('starts the agent in Working, or resumes its session', () => {
    expect(moveOnBoard(item(), 'working').kind).toBe('start');
    expect(moveOnBoard(item({ status: 'doing' }, { session: session('stopped') }), 'working')).toMatchObject({ kind: 'resume', sessionId: 's' });
    const noFolder = { ...item(), company: companySchema.parse({ id: 'c', name: 'Client', color: '#5BB8A6' }) };
    expect(moveOnBoard(noFolder, 'working').kind).toBe('refuse');
  });

  it('marks it done, and reopens it from Done', () => {
    expect(moveOnBoard(item(), 'done')).toEqual({ kind: 'patch', patch: { status: 'done', boardLane: undefined } });
    expect(moveOnBoard(item({ status: 'done' }), 'next')).toEqual({ kind: 'patch', patch: { status: 'todo', boardLane: undefined } });
  });

  it('does not contradict a running agent or a pull request', () => {
    expect(moveOnBoard(item({ status: 'doing' }, { session: session('working') }), 'next').kind).toBe('refuse');
    expect(moveOnBoard(item({ status: 'doing' }, { session: session('needs-input') }), 'done').kind).toBe('refuse');
    expect(moveOnBoard(item({ status: 'doing' }, { session: session('idle') }), 'done').kind).toBe('refuse');
    expect(moveOnBoard(item({ status: 'doing' }, { pulls: [pull] }), 'merged')).toEqual({ kind: 'refuse', reason: 'Pull request api #7 decides where this task goes.' });
    expect(moveOnBoard(item({ status: 'doing' }, { pulls: [pull] }), 'done').kind).toBe('patch');
    expect(placeOnBoard(item({ status: 'doing', boardLane: 'merged' }, { session: session('working') })).lane).toBe('working');
    expect(placeOnBoard(item({ status: 'doing', boardLane: 'next' }, { pulls: [pull] })).lane).toBe('in-review');
  });

  it('leaves it alone when dropped where it was', () => {
    expect(moveOnBoard(item(), 'next')).toEqual({ kind: 'none' });
  });

  it('shows where you moved it in the task', () => {
    const journey = taskJourney(item({ status: 'doing', boardLane: 'in-review' }, { company: companySchema.parse({ id: 'c', name: 'Client', color: '#5BB8A6', projects: [{ id: 'api', name: 'api', path: '/a' }] }) }));
    expect(journey.stages[journey.stage]).toBe('Team review');
    expect(journey.now).toBe('Moved by you');
  });
});

describe('when something last happened', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  it('reads as a short time', () => {
    expect(timeAgo('2026-11-05T11:59:40Z', now)).toBe('just now');
    expect(timeAgo('2026-11-05T11:55:00Z', now)).toBe('5 minutes ago');
    expect(timeAgo('2026-11-05T11:00:00Z', now)).toBe('1 hour ago');
    expect(timeAgo('2026-11-02T12:00:00Z', now)).toBe('3 days ago');
    expect(timeAgo('not a date', now)).toBe('');
  });
});
