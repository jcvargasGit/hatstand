// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '../../src/shared/api';
import { withDoneDate } from '../../src/main/store';
import { normalizeGitHubPull } from '../../src/main/pull-requests';
import { buildSystemPrompt } from '../../src/main/agents/task-prompt';
import { ClosedPage } from '../../src/renderer/src/components/ClosedPage';
import { TaskBoard } from '../../src/renderer/src/components/TaskBoard';
import { WorkPeriodForm } from '../../src/renderer/src/components/WorkPeriodForm';
import { boardLanes, placeOnBoard } from '../../src/renderer/src/lib/board';
import { closedGroups, descriptionSummary } from '../../src/renderer/src/lib/closed-tasks';
import { doneWarning, taskJourney } from '../../src/renderer/src/lib/task-journey';
import type { TodayItem } from '../../src/renderer/src/lib/today';
import { isReadyToMerge, pullChips, pullTrouble } from '../../src/shared/review';
import { companySchema, taskSchema, type PullRequest, type Session, type Task } from '../../src/shared/schemas';
import { taskTypeOf } from '../../src/shared/task-types';
import { describePeriod, isInCurrentPeriod, periodLabel, periodOf } from '../../src/shared/work-periods';

const updateTask = vi.fn(async () => undefined);
const saveCompany = vi.fn(async () => undefined);

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: {
    updateTask: (...args: unknown[]) => (updateTask as (...values: unknown[]) => Promise<undefined>)(...args),
    saveCompany: (...args: unknown[]) => (saveCompany as (...values: unknown[]) => Promise<undefined>)(...args),
  },
}));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const repos = [{ id: 'api', name: 'api', path: '/a' }];
const client = (change: Record<string, unknown> = {}) => companySchema.parse({ id: 'c', name: 'Client', color: '#5BB8A6', projects: repos, ...change });
const noRepos = () => client({ projects: [] });
const task = (change: Record<string, unknown> = {}): Task => taskSchema.parse({ id: 't', companyId: 'c', title: 'Fix it', status: 'doing', createdAt: '2026-01-01T12:00:00', updatedAt: '2026-01-01T12:00:00', ...change });
const pull = (change: Partial<PullRequest> = {}): PullRequest => ({
  projectId: 'api', repo: 'api', number: 7, title: 'Fix', url: 'https://x', state: 'open', draft: false, headSha: 'a', ci: 'passing', review: 'none', conflicts: false, failedChecks: [], comments: [], ...change,
});
const thread = (author: string) => ({ id: `thread-${author}`, author, body: 'Fix this', resolvable: true });
const session = (state: Session['state']): Session => ({ id: 's', taskId: 't', companyId: 'c', accountId: 'a', cwd: '/x', state, startedAt: 'x', updatedAt: 'x' });
const snapshot = (tasks: Task[], company = client()) => ({ tasks, companies: [company], sessions: [], reviews: {}, accounts: { accounts: [] } }) as unknown as Snapshot;
const stageOf = (item: TodayItem, commits = 0) => {
  const journey = taskJourney(item, commits);
  return journey.stages[journey.stage];
};

describe('work periods', () => {
  it('counts days and weeks from the first day, in both directions', () => {
    const threeDays = { every: 3, unit: 'days', startsOn: '2026-11-01' } as const;
    expect(periodOf(threeDays, '2026-11-03')).toEqual({ start: '2026-11-01', end: '2026-11-03' });
    expect(periodOf(threeDays, '2026-11-04')).toEqual({ start: '2026-11-04', end: '2026-11-06' });
    expect(periodOf(threeDays, '2026-10-31')).toEqual({ start: '2026-10-29', end: '2026-10-31' });
    expect(periodOf({ every: 2, unit: 'weeks', startsOn: '2026-11-02' }, '2026-11-16')).toEqual({ start: '2026-11-16', end: '2026-11-29' });
  });

  it('uses calendar months, and keeps month ends valid', () => {
    expect(periodOf({ every: 1, unit: 'months', startsOn: '2026-01-01' }, '2026-02-28')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    const fromThe31st = { every: 1, unit: 'months', startsOn: '2026-01-31' } as const;
    expect(periodOf(fromThe31st, '2026-03-01')).toEqual({ start: '2026-02-28', end: '2026-03-30' });
    expect(periodOf(fromThe31st, '2026-01-30')).toEqual({ start: '2025-12-31', end: '2026-01-30' });
  });

  it('crosses a daylight saving change without losing a day', () => {
    expect(periodOf({ every: 1, unit: 'days', startsOn: '2026-01-01' }, '2026-11-01')).toEqual({ start: '2026-11-01', end: '2026-11-01' });
  });

  it('reads as plain text', () => {
    expect(periodLabel({ start: '2026-11-01', end: '2026-11-30' })).toBe('Nov 1 to Nov 30, 2026');
    expect(periodLabel({ start: '2026-12-20', end: '2027-01-02' })).toBe('Dec 20, 2026 to Jan 2, 2027');
    expect(describePeriod({ every: 2, unit: 'weeks', startsOn: 'x' })).toBe('Every 2 weeks');
    expect(describePeriod({ every: 1, unit: 'months', startsOn: 'x' })).toBe('Every month');
  });

  it('knows whether a date is in the current period', () => {
    const period = { every: 3, unit: 'days', startsOn: '2026-11-01' } as const;
    const now = new Date('2026-11-05T12:00:00');
    expect(isInCurrentPeriod(period, '2026-11-04T08:00:00', now)).toBe(true);
    expect(isInCurrentPeriod(period, '2026-11-03T08:00:00', now)).toBe(false);
  });
});

describe('the date a task closes', () => {
  it('is set once when it closes, and cleared when it reopens', () => {
    const open = task();
    const closed = withDoneDate(open, { ...open, status: 'done' }, '2026-11-05T10:00:00Z');
    expect(closed.doneAt).toBe('2026-11-05T10:00:00Z');
    expect(withDoneDate(closed, { ...closed, title: 'Renamed' }, '2026-12-01T10:00:00Z').doneAt).toBe('2026-11-05T10:00:00Z');
    expect(withDoneDate(closed, { ...closed, status: 'doing' }).doneAt).toBeUndefined();
  });
});

describe('the Done lane and the Closed tab', () => {
  const now = new Date('2026-11-20T12:00:00');
  const thisMonth = task({ id: 'new', title: 'New one', status: 'done', doneAt: '2026-11-05T12:00:00' });
  const lastMonth = task({ id: 'old', title: 'Old one', status: 'done', doneAt: '2026-10-05T12:00:00' });
  const archived = task({ id: 'gone', title: 'Archived one', status: 'done', doneAt: '2026-11-06T12:00:00', archivedAt: '2026-11-07T12:00:00' });

  it('shows only the current period on the board, however many there are', () => {
    const many = Array.from({ length: 12 }, (_, index) => task({ id: `n${index}`, status: 'done', doneAt: '2026-11-05T12:00:00' }));
    const done = boardLanes(snapshot([lastMonth, ...many]), 'c', now).find((lane) => lane.id === 'done');
    expect(done?.cards.map((card) => card.task.id)).toEqual(many.map((item) => item.id));
  });

  it('groups closed tasks by period, newest first, without archived ones', () => {
    const groups = closedGroups(snapshot([lastMonth, thisMonth, archived]), client(), now);
    expect(groups.map((group) => [group.label, group.current, group.tasks.map((item) => item.id)])).toEqual([
      ['Nov 1 to Nov 30, 2026', true, ['new']],
      ['Oct 1 to Oct 31, 2026', false, ['old']],
    ]);
  });

  it('groups by the period set for this client', () => {
    const company = client({ workPeriod: { every: 2, unit: 'weeks', startsOn: '2026-10-26' } });
    expect(closedGroups(snapshot([thisMonth], company), company, now)[0]?.label).toBe('Oct 26 to Nov 8, 2026');
  });

  it('marks a date it can only approximate, and opens the task', async () => {
    const onOpenTask = vi.fn();
    const legacy = task({ id: 'legacy', title: 'Legacy one', status: 'done', updatedAt: '2026-03-04T12:00:00' });
    render(<ClosedPage snapshot={snapshot([legacy, thisMonth])} company={client()} onOpenTask={onOpenTask} onChanged={async () => undefined} />);
    const row = screen.getByRole('button', { name: 'Legacy one' }).closest('tr') as HTMLElement;
    expect(within(row).getByText('About Mar 4, 2026')).toBeTruthy();
    expect(screen.getByText('Nov 5, 2026')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'New one' }));
    expect(onOpenTask).toHaveBeenCalledWith('new');
  });

  it('keeps the whole text of a row for when it is cut, and still opens the task', async () => {
    const onOpenTask = vi.fn();
    const longTitle = 'A very long title '.repeat(10).trim();
    const longArea = 'An area with a very long name';
    const company = client({ subdomains: [{ id: 'area', name: longArea }] });
    const longGuide = 'A guide with a very long name';
    const guide = { playbookId: 'own', name: longGuide, steps: [{ name: 'a', prompt: 'b' }], current: 0, promptPending: false };
    const long = task({ id: 'long', title: longTitle, status: 'done', doneAt: '2026-11-05T12:00:00', subdomainId: 'area', guide });
    render(<ClosedPage snapshot={snapshot([long], company)} company={company} onOpenTask={onOpenTask} onChanged={async () => undefined} />);
    const title = screen.getByRole('button', { name: longTitle });
    expect(title.getAttribute('title')).toBe(longTitle);
    expect(screen.getByText(longArea).getAttribute('title')).toBe(longArea);
    expect(screen.getByText(longGuide).getAttribute('title')).toBe(longGuide);
    await userEvent.click(title);
    expect(onOpenTask).toHaveBeenCalledWith('long');
  });

  it('shows the number, the first line of the description and the ticket of each task', () => {
    const jira = task({ id: 'j', number: 12, title: 'Ship it', status: 'done', doneAt: '2026-11-05T12:00:00', description: '## Why\n\nClients wait a day.', source: { kind: 'jira', key: 'ACME-12', url: 'https://example.atlassian.net/browse/ACME-12' } });
    const local = task({ id: 'l', number: 13, title: 'Tidy up', status: 'done', doneAt: '2026-11-06T12:00:00', source: { kind: 'github', key: '#40' } });
    render(<ClosedPage snapshot={snapshot([jira, local])} company={client()} onOpenTask={vi.fn()} onChanged={async () => undefined} />);
    const row = screen.getByRole('button', { name: /Ship it/ }).closest('tr') as HTMLElement;
    expect(within(row).getByText('#12')).toBeTruthy();
    expect(within(row).getByText('Why').getAttribute('title')).toBe('Why');
    const link = within(row).getByRole('link', { name: 'Open Jira ticket ACME-12' });
    expect(link.getAttribute('href')).toBe('https://example.atlassian.net/browse/ACME-12');
    expect(screen.getByRole('columnheader', { name: 'Ticket' })).toBeTruthy();
    const other = screen.getByRole('button', { name: /Tidy up/ }).closest('tr') as HTMLElement;
    expect(within(other).getByTitle('GitHub issue #40').textContent).toBe('#40');
  });

  it('leaves out Ticket and Area when no task of the period has one', () => {
    render(<ClosedPage snapshot={snapshot([task({ status: 'done', doneAt: '2026-11-05T12:00:00' })])} company={client()} onOpenTask={vi.fn()} onChanged={async () => undefined} />);
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Task', 'Guide', 'Closed']);
  });

  it('sums up a description by its first line with text, without Markdown marks', () => {
    expect(descriptionSummary('\n\n# Title\nmore')).toBe('Title');
    expect(descriptionSummary('- [first item](x)')).toBe('[first item](x)');
    expect(descriptionSummary('1. Step one')).toBe('Step one');
    expect(descriptionSummary('#hashtag stays')).toBe('#hashtag stays');
    expect(descriptionSummary('')).toBe('');
  });

  it('says so when nothing is closed', () => {
    render(<ClosedPage snapshot={snapshot([task()])} company={client()} onOpenTask={vi.fn()} onChanged={async () => undefined} />);
    expect(screen.getByText(/Nothing closed yet/)).toBeTruthy();
  });

  it('saves the period of this client', async () => {
    const onChanged = vi.fn(async () => undefined);
    render(<ClosedPage snapshot={snapshot([])} company={client()} onOpenTask={vi.fn()} onChanged={onChanged} />);
    const every = screen.getByLabelText('Every');
    await userEvent.clear(every);
    await userEvent.type(every, '3');
    await userEvent.selectOptions(screen.getByLabelText('Unit'), 'days');
    await userEvent.click(screen.getByRole('button', { name: 'Save period' }));
    expect(saveCompany).toHaveBeenCalledWith(expect.objectContaining({ workPeriod: { every: 3, unit: 'days', startsOn: '2026-01-01' } }));
    expect(onChanged).toHaveBeenCalled();
  });

  it('refuses a period that is not a whole number', async () => {
    const onSave = vi.fn();
    render(<WorkPeriodForm period={{ every: 1, unit: 'months', startsOn: '2026-01-01' }} busy={false} onSave={onSave} />);
    const every = screen.getByLabelText('Every');
    await userEvent.clear(every);
    await userEvent.type(every, '0');
    await userEvent.click(screen.getByRole('button', { name: 'Save period' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('A period lasts at least 1.')).toBeTruthy();
  });
});

describe('the type of a task', () => {
  it('comes from a type saved earlier, then its guide, then whether the client has code', () => {
    const guide = (playbookId: string) => ({ playbookId, name: 'x', steps: [{ name: 'a', prompt: 'b' }], current: 0, promptPending: false });
    expect(taskTypeOf(task({ type: 'release' }), client())).toBe('release');
    expect(taskTypeOf(task({ guide: guide('rfc') }), client())).toBe('design');
    expect(taskTypeOf(task({ guide: { ...guide('own'), type: 'report' } }), client())).toBe('report');
    expect(taskTypeOf(task({ guide: guide('own') }), client())).toBe('implementation');
    expect(taskTypeOf(task(), client())).toBe('implementation');
    expect(taskTypeOf(task(), noRepos())).toBeUndefined();
  });

  it('reaches the agent, with the review rules when there is no guide', () => {
    const prompt = (item: Task) => buildSystemPrompt({ company: client(), task: item, repositories: [], companyInstructions: '', knowledgeDirs: [], notesFile: '/n', notes: '' });
    expect(prompt(task())).toContain('Type: Implementation');
    expect(prompt(task())).toContain('Ask before each push and before opening a pull request.');
    expect(prompt(task({ type: 'report' }))).toContain('Type: Report');
    expect(prompt(task({ type: 'report' }))).not.toContain('How implementation work goes');
  });
});

describe('the stages of an implementation task', () => {
  const item = (change: Partial<TodayItem> = {}, taskChange: Record<string, unknown> = {}): TodayItem => ({ task: task(taskChange), company: client(), ...change });
  const worktree = { projectId: 'api', path: '/w', branch: 'b', base: 'main' };

  it('follows the work up to the commit', () => {
    expect(stageOf(item())).toBe('Described');
    expect(stageOf(item({ session: session('working') }))).toBe('Planning');
    expect(stageOf(item({ session: session('working') }, { worktrees: [worktree] }))).toBe('Implementing');
    expect(stageOf(item({ session: session('idle') }, { worktrees: [worktree] }), 2)).toBe('Committed');
  });

  it('also follows the step of the guide', () => {
    const guide = { playbookId: 'implement', name: 'Implement', steps: [{ name: 'Understand the task', prompt: 'a' }, { name: 'Build it', prompt: 'b' }], current: 1, promptPending: false };
    expect(stageOf(item({ session: session('idle') }, { guide }))).toBe('Implementing');
  });

  it('follows the pull request after that', () => {
    expect(stageOf(item({ pulls: [pull({ draft: true })] }))).toBe('PR open');
    expect(stageOf(item({ pulls: [pull({ copilot: 'pending' })] }))).toBe('Copilot review');
    expect(stageOf(item({ pulls: [pull({ copilot: 'reviewed', comments: [thread('copilot-pull-request-reviewer')] })] }))).toBe('Copilot review');
    expect(stageOf(item({ pulls: [pull({ copilot: 'reviewed', comments: [thread('alice')] })] }))).toBe('Team review');
    expect(stageOf(item({ pulls: [pull({ copilot: 'reviewed', reviewRequired: false })] }))).toBe('Waiting for merge');
    expect(stageOf(item({ pulls: [pull({ state: 'merged' })] }))).toBe('Merged');
  });

  it('leaves out Copilot when the repository does not use it', () => {
    expect(taskJourney(item({ pulls: [pull()] })).stages).not.toContain('Copilot review');
    expect(taskJourney(item()).stages).toContain('Copilot review');
  });

  it('has fewer stages without a repository, and plain ones with no type', () => {
    const noCode = { task: task({ type: 'implementation' }), company: noRepos() };
    expect(taskJourney(noCode).stages).toEqual(['Described', 'Planning', 'Implementing', 'Done']);
    expect(taskJourney({ task: task(), company: noRepos() }).stages).toEqual(['Not started', 'In progress', 'Done']);
  });

  it('shows the steps of the guide for other types', () => {
    const guide = { playbookId: 'report', name: 'Report', steps: [{ name: 'Gather', prompt: 'a' }, { name: 'Draft', prompt: 'b' }], current: 1, promptPending: false };
    const journey = taskJourney({ task: task({ type: 'report', guide }), company: client() });
    expect(journey.stages).toEqual(['Gather', 'Draft', 'Done']);
    expect(journey.stage).toBe(1);
    expect(doneWarning({ task: task({ type: 'report', guide }), company: client() })).toBeNull();
    expect(doneWarning({ task: task({ type: 'report', guide: { ...guide, current: 0 } }), company: client() })).toBe('This task has not reached Draft.');
  });

  it('warns before closing work that has not merged, and not otherwise', () => {
    expect(doneWarning(item())).toBe('This task has not reached Merged.');
    expect(doneWarning(item({ pulls: [pull({ state: 'merged' })] }))).toBeNull();
    expect(doneWarning({ task: task(), company: noRepos() })).toBeNull();
    expect(doneWarning(item({}, { status: 'done' }))).toBeNull();
  });
});

describe('the state of a pull request', () => {
  it('counts open review threads as work to do, but not plain comments', () => {
    expect(pullTrouble(pull({ comments: [thread('copilot-pull-request-reviewer')] }))).toBe('Open comments');
    expect(pullTrouble(pull({ comments: [{ id: 'comment-1', author: 'alice', body: 'Thanks' }] }))).toBeNull();
  });

  it('is not ready while threads are open, even when approved', () => {
    expect(isReadyToMerge(pull({ review: 'approved' }))).toBe(true);
    expect(isReadyToMerge(pull({ review: 'approved', comments: [thread('alice')] }))).toBe(false);
  });

  it('is ready without an approval when the repository requires none', () => {
    expect(isReadyToMerge(pull({ reviewRequired: false }))).toBe(true);
    expect(isReadyToMerge(pull({ reviewRequired: true }))).toBe(false);
    expect(isReadyToMerge(pull({ reviewRequired: false, copilot: 'pending' }))).toBe(false);
    expect(placeOnBoard({ task: task(), company: client(), pulls: [pull({ reviewRequired: false })] })).toEqual({ lane: 'ready', reason: 'Ready for you to merge' });
  });

  it('shows what it is waiting for', () => {
    const chips = (change: Partial<PullRequest>) => pullChips(pull(change)).map((chip) => chip.text);
    expect(chips({ reviewRequired: false })).toEqual(['CI passing']);
    expect(chips({ copilot: 'pending' })).toEqual(['CI passing', 'Waiting for review', 'Copilot reviewing']);
  });

  it('reads Copilot and the review rule from GitHub', () => {
    const base = { number: 1, title: 'x', url: 'u', state: 'OPEN', isDraft: false, headRefOid: 'a' } as const;
    const identity = { projectId: 'api', repo: 'api' };
    const bot = { login: 'copilot-pull-request-reviewer' };
    const pending = normalizeGitHubPull({ ...base, reviewDecision: 'REVIEW_REQUIRED', reviewRequests: { nodes: [{ requestedReviewer: bot }, { requestedReviewer: {} }] } }, identity);
    expect(pending).toMatchObject({ copilot: 'pending', reviewRequired: true });
    const reviewed = normalizeGitHubPull({
      ...base,
      reviews: { nodes: [{ state: 'COMMENTED', author: bot }] },
      reviewThreads: { nodes: [{ isResolved: false, comments: { nodes: [{ body: 'Fix', author: bot }] } }, { isResolved: true, comments: { nodes: [{ body: 'Old', author: bot }] } }] },
    }, identity);
    expect(reviewed).toMatchObject({ copilot: 'reviewed', reviewRequired: false });
    expect(reviewed.comments.map((comment) => [comment.body, comment.resolvable])).toEqual([['Fix', true]]);
    expect(normalizeGitHubPull(base, identity).copilot).toBeUndefined();
  });
});

describe('marking done on the board', () => {
  const renderBoard = (tasks: Task[]) => render(<TaskBoard snapshot={snapshot(tasks)} companyId="c" onSelectTask={vi.fn()} onOpenClosed={onOpenClosed} onChanged={async () => undefined} />);
  const onOpenClosed = vi.fn();

  it('asks first when stages are left, and lets you go ahead', async () => {
    renderBoard([task()]);
    await userEvent.click(screen.getByRole('button', { name: 'Mark Fix it done' }));
    expect(updateTask).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('This task has not reached Merged.');
    await userEvent.click(screen.getByRole('button', { name: 'Mark done anyway' }));
    expect(updateTask).toHaveBeenCalledWith('t', { status: 'done', boardLane: undefined });
  });

  it('lets you cancel', async () => {
    renderBoard([task()]);
    await userEvent.click(screen.getByRole('button', { name: 'Mark Fix it done' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('links to everything closed', async () => {
    renderBoard([]);
    await userEvent.click(screen.getByRole('button', { name: 'See all closed' }));
    expect(onOpenClosed).toHaveBeenCalledWith('c');
  });
});
