// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskStateIcon } from '../../src/renderer/src/components/TaskStateIcon';
import { moveOnBoard, placeOnBoard } from '../../src/renderer/src/lib/board';
import { doneWarning, taskJourney } from '../../src/renderer/src/lib/task-journey';
import { taskStateText, type TodayItem } from '../../src/renderer/src/lib/today';
import { companySchema, taskSchema, type BranchFact, type PullRequest, type Session } from '../../src/shared/schemas';
import { finishedWork } from '../../src/shared/task-finish';
import { withNotesStatus } from '../../src/shared/task-notes';

const withRepo = companySchema.parse({ id: 'c', name: 'Client', color: '#5BB8A6', projects: [{ id: 'p', name: 'web', path: '/web' }] });
const noRepo = companySchema.parse({ id: 'c', name: 'Client', color: '#5BB8A6' });
const task = (change: Record<string, unknown> = {}) => taskSchema.parse({ id: 't', companyId: 'c', title: 'Fix it', status: 'doing', createdAt: 'x', updatedAt: 'x', ...change });
const session = (state: Session['state']): Session => ({ id: 's', taskId: 't', companyId: 'c', accountId: 'a', cwd: '/x', state, startedAt: 'x', updatedAt: 'x' });
const branch = (change: Partial<BranchFact> = {}): BranchFact => ({ projectId: 'p', hasWork: true, inMain: true, clean: true, ...change });
const pull = (change: Partial<PullRequest> = {}): PullRequest => ({
  projectId: 'p', repo: 'web', number: 1, title: 'PR', url: 'u', state: 'open', draft: false, headSha: 'a', ci: 'none', review: 'none', conflicts: false, failedChecks: [], comments: [], ...change,
});
const code = (facts: Partial<TodayItem> = {}): TodayItem => ({ task: task(), company: withRepo, ...facts });

afterEach(cleanup);

describe('when a task with code is finished', () => {
  it('is finished when its work is in the main branch', () => {
    expect(finishedWork(code({ branches: [branch()] }))).toBe('merged');
    expect(finishedWork(code({ pulls: [pull({ state: 'merged', intoMain: true })] }))).toBe('merged');
    expect(finishedWork(code({ pulls: [pull({ state: 'merged', intoMain: true })], branches: [branch({ inMain: false })] }))).toBe('merged');
  });

  it('ignores done from the agent while the work is not in the main branch', () => {
    expect(finishedWork(code({ task: task({ agentStatus: 'done' }) }))).toBeNull();
    expect(finishedWork(code({ task: task({ agentStatus: 'done' }), branches: [branch({ hasWork: false, inMain: false })] }))).toBeNull();
    expect(finishedWork(code({ task: task({ agentStatus: 'done' }), branches: [branch({ inMain: false })] }))).toBeNull();
  });

  it.each([
    ['a branch with no commits', { branches: [branch({ hasWork: false, inMain: false })] }],
    ['a copy with changes not committed', { branches: [branch({ clean: false })] }],
    ['changes left after a merged pull request', { pulls: [pull({ state: 'merged', intoMain: true })], branches: [branch({ clean: false, inMain: false })] }],
    ['a pull request merged into another branch', { pulls: [pull({ state: 'merged', intoMain: false })] }],
    ['a pull request closed without merging', { pulls: [pull({ state: 'closed' })], branches: [branch({ inMain: false })] }],
    ['an open pull request', { pulls: [pull()], branches: [branch()] }],
    ['a second repository still open', { branches: [branch(), branch({ projectId: 'q', inMain: false })] }],
  ])('is not finished with %s', (_name, facts) => {
    expect(finishedWork(code(facts))).toBeNull();
  });
});

describe('when a task without code is finished', () => {
  it('follows the guide: an RFC does not wait for a merge, and Implement a task does', () => {
    const guide = (playbookId: string) => ({ playbookId, name: 'x', steps: [{ name: 'a', prompt: 'b' }], current: 0, promptPending: false });
    expect(finishedWork(code({ task: task({ guide: guide('rfc'), agentStatus: 'done' }) }))).toBe('reported');
    expect(finishedWork(code({ task: task({ guide: guide('implement'), agentStatus: 'done' }) }))).toBeNull();
    expect(finishedWork(code({ task: task({ agentStatus: 'done' }) }))).toBeNull();
  });

  it('trusts the report of the agent for types that do not merge code', () => {
    expect(finishedWork(code({ task: task({ type: 'planning', agentStatus: 'done' }) }))).toBe('reported');
    expect(finishedWork(code({ task: task({ type: 'report', agentStatus: 'in progress' }) }))).toBeNull();
    expect(finishedWork({ task: task({ agentStatus: 'done' }), company: noRepo })).toBe('reported');
  });

  it('still needs the merge when one of those tasks changed code', () => {
    expect(finishedWork(code({ task: task({ type: 'investigation', agentStatus: 'done' }), branches: [branch({ inMain: false })] }))).toBeNull();
  });

  it('never applies to a task that is closed, archived or an idea', () => {
    for (const change of [{ status: 'done' }, { status: 'idea' }, { archivedAt: 'x' }]) {
      expect(finishedWork(code({ task: task({ type: 'report', agentStatus: 'done', ...change }) }))).toBeNull();
    }
  });
});

describe('a finished task on the board', () => {
  const merged = code({ session: session('idle'), branches: [branch()] });
  const reported = code({ task: task({ type: 'report', agentStatus: 'done' }), session: session('idle') });

  it('goes to Merged with code, and to Needs you without it', () => {
    expect(placeOnBoard(merged)).toEqual({ lane: 'merged', reason: 'Ready to close' });
    expect(placeOnBoard(reported)).toEqual({ lane: 'needs-you', reason: 'Ready to close' });
  });

  it('shows a busy agent first', () => {
    expect(placeOnBoard({ ...merged, session: session('needs-input') }).reason).toBe('Needs your answer');
    expect(placeOnBoard({ ...merged, session: session('working') }).reason).toBe('Agent is working');
  });

  it('says when a merged pull request still leaves work', () => {
    expect(placeOnBoard(code({ pulls: [pull({ state: 'merged', intoMain: false })] }))).toEqual({ lane: 'merged', reason: 'Merged, but work is left' });
  });

  it('closes with one action, stopping a session that is only waiting', () => {
    expect(moveOnBoard(merged, 'done')).toMatchObject({ kind: 'close', sessionId: 's', patch: { status: 'done' } });
    expect(moveOnBoard(code({ session: session('idle') }), 'done').kind).toBe('refuse');
    expect(moveOnBoard({ ...merged, session: session('working') }, 'done').kind).toBe('refuse');
    expect(doneWarning(merged)).toBeNull();
  });

  it('reaches the last stage with a merge that had no pull request', () => {
    const journey = taskJourney(merged);
    expect(journey.stages[journey.stage]).toBe('Merged');
    expect(journey).toMatchObject({ now: 'Ready to close', next: 'Close it, and remove its copy of the code' });
  });
});

describe('the state a task shows', () => {
  const label = (item: TodayItem) => {
    render(<TaskStateIcon item={item} />);
    const name = screen.getByRole('img').getAttribute('aria-label');
    cleanup();
    return name;
  };

  it.each([
    ['Open comments', pull({ comments: [{ id: '1', author: 'alice', body: 'x', resolvable: true }] })],
    ['Changes requested', pull({ review: 'changes-requested' })],
    ['CI failing', pull({ ci: 'failing' })],
    ['Merge conflict', pull({ conflicts: true })],
    ['Waiting for review', pull()],
    ['CI running', pull({ ci: 'running' })],
    ['Draft', pull({ draft: true })],
    ['Copilot reviewing', pull({ copilot: 'pending' })],
    ['Ready for you to merge', pull({ review: 'approved' })],
  ])('shows %s instead of "Your turn"', (name, openPull) => {
    const item = code({ session: session('idle'), pulls: [openPull] });
    expect(label(item)).toBe(name);
    expect(taskStateText(item)).toBe(name);
  });

  it('uses a bug for comments and a green check only when ready to close', () => {
    render(<TaskStateIcon item={code({ pulls: [pull({ review: 'changes-requested' })] })} />);
    expect(screen.getByRole('img').querySelector('.lucide-bug')).toBeTruthy();
    cleanup();
    render(<TaskStateIcon item={code({ branches: [branch()] })} />);
    expect(screen.getByRole('img', { name: 'Ready to close' }).querySelector('.state-icon-ready')).toBeTruthy();
  });

  it('keeps a busy agent and a closed task over the pull request', () => {
    expect(label(code({ session: session('working'), pulls: [pull()] }))).toBe('Working');
    expect(label(code({ task: task({ status: 'done' }), branches: [branch()] }))).toBe('Done');
  });
});

describe('writing the status in the notes', () => {
  it('replaces only the status section', () => {
    expect(withNotesStatus('## TL;DR\nx\n\n## Status\ndone\n\n## Decisions\ny', 'in progress')).toBe('## TL;DR\nx\n\n## Status\nin progress\n\n## Decisions\ny');
  });

  it('ignores a heading inside a code block', () => {
    const notes = '```\n## Status\ndone\n```';
    expect(withNotesStatus(notes, 'in progress')).toBe(notes);
  });
});
