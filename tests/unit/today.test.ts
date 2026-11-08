import { describe, expect, it } from 'vitest';
import { clientTree, groupToday, inkOn, nextWaiting, sharedSubdomain, taskStateText, waitingByClient, waitingCount } from '../../src/renderer/src/lib/today';
import type { Snapshot } from '../../src/shared/api';
import type { Company, Session, SessionState, Task } from '../../src/shared/schemas';

const company = (id: string): Company => ({
  id,
  name: id,
  color: '#112233',
  skipPermissions: false,
  origin: 'existing', hasCode: true, confirmedSteps: [],
  protectedPaths: [], links: [],
  subdomains: [],
  projects: [],
  context: {},
});

const task = (id: string, companyId: string, status: Task['status'] = 'doing'): Task => ({
  isolated: false, worktrees: [], checklist: [], priority: 'none', note: '', 
  id,
  companyId,
  title: id,
  description: '',
  projectIds: [],
  status,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
});

const created = (item: Task, createdAt: string): Task => ({ ...item, createdAt });

const session = (taskId: string, state: SessionState, startedAt = '2026-01-02'): Session => ({
  id: `00000000-0000-4000-8000-${taskId.padStart(12, '0')}`,
  taskId,
  companyId: 'a',
  accountId: 'x',
  cwd: '/',
  state,
  startedAt,
  updatedAt: startedAt,
});

const snapshot = (tasks: Task[], sessions: Session[]): Snapshot => ({
  companies: [company('a'), company('b')],
  accounts: { accounts: [] },
  tasks,
  sessions,
  reviews: {},
  todayLayout: 'list',
  guideNewTasks: true,
  localKnowledge: [],
  localPlugin: [],
  starterInstructions: [],
  clientFolders: {},
});

const titles = (items: { task: Task }[]) => items.map((item) => item.task.title);

describe('waitingByClient', () => {
  const waiting = snapshot(
    [created(task('old-a', 'a'), '2026-01-01'), created(task('new-a', 'a'), '2026-01-03'), created(task('only-b', 'b'), '2026-01-02')],
    [session('old-a', 'needs-input'), session('new-a', 'idle'), session('only-b', 'idle')],
  );

  it('follows the order of the clients, with the newest first inside each one', () => {
    const groups = waitingByClient({ ...waiting, companies: [company('b'), company('a'), company('empty')] });
    expect(groups.map((group) => group.company.id)).toEqual(['b', 'a']);
    expect(groups.map((group) => titles(group.items))).toEqual([['only-b'], ['new-a', 'old-a']]);
  });

  it('leaves out archived clients', () => {
    const groups = waitingByClient({ ...waiting, companies: [company('a'), { ...company('b'), archivedAt: '2026-01-01' }] });
    expect(groups.map((group) => group.company.id)).toEqual(['a']);
  });

  it('moves to the next task in that same order, and wraps around', () => {
    const reordered = { ...waiting, companies: [company('b'), company('a')] };
    expect(nextWaiting(reordered, null)?.task.id).toBe('only-b');
    expect(nextWaiting(reordered, 'only-b')?.task.id).toBe('new-a');
    expect(nextWaiting(reordered, 'old-a')?.task.id).toBe('only-b');
    expect(nextWaiting(snapshot([], []), null)).toBeUndefined();
  });
});

describe('groupToday', () => {
  it('puts each task where it needs attention, newest first within each group', () => {
    const groups = groupToday(
      snapshot(
        [created(task('ask', 'a'), '2026-01-01'), created(task('idle', 'a'), '2026-01-02'), task('run', 'b'), created(task('paused', 'a'), '2026-01-01'), created(task('new', 'b', 'todo'), '2026-01-02')],
        [session('idle', 'idle'), session('ask', 'needs-input'), session('run', 'working'), session('paused', 'stopped')],
      ),
      null,
    );
    expect(titles(groups.waiting)).toEqual(['idle', 'ask']);
    expect(titles(groups.working)).toEqual(['run']);
    expect(titles(groups.next)).toEqual(['new', 'paused']);
  });

  it('keeps the order within a group when a task is updated', () => {
    const older = created(task('older', 'a'), '2026-01-01');
    const newer = created(task('newer', 'a'), '2026-01-02');
    const groups = groupToday(snapshot([{ ...older, updatedAt: '2026-03-01' }, { ...newer, status: 'todo' }], []), null);
    expect(titles(groups.next)).toEqual(['newer', 'older']);
  });

  it('hides finished tasks', () => {
    const groups = groupToday(snapshot([task('finished', 'a', 'done')], []), null);
    expect(titles(groups.next)).toEqual([]);
  });

  it('shows one client when one is chosen', () => {
    const groups = groupToday(snapshot([task('mine', 'a'), task('theirs', 'b')], []), 'a');
    expect(titles(groups.next)).toEqual(['mine']);
  });

  it('uses the latest session of a task', () => {
    const groups = groupToday(
      snapshot(
        [task('t', 'a')],
        [session('t', 'stopped', '2026-01-01'), { ...session('t', 'working', '2026-01-03'), id: crypto.randomUUID() }],
      ),
      null,
    );
    expect(titles(groups.working)).toEqual(['t']);
  });
});

describe('waitingCount', () => {
  it('counts only the sessions waiting in that client', () => {
    const data = snapshot([task('t', 'a')], [session('t', 'needs-input')]);
    expect(waitingCount(data, 'a')).toBe(1);
    expect(waitingCount(data, 'b')).toBe(0);
  });
});

describe('clientTree', () => {
  it('lists the newest task first, and keeps done and archived tasks apart', () => {
    const archived = { ...task('old', 'a'), archivedAt: '2026-01-03' };
    const tree = clientTree(
      snapshot([created(task('asking', 'a'), '2026-01-01'), created(task('later', 'a', 'todo'), '2026-01-02'), task('finished', 'a', 'done'), archived], [session('asking', 'needs-input')]),
    );
    expect(titles(tree[0]?.active ?? [])).toEqual(['later', 'asking']);
    expect(titles(tree[0]?.finished ?? []).sort()).toEqual(['finished', 'old']);
    expect(tree[1]?.active).toEqual([]);
  });

  it('keeps a task in its place when its agent starts working', () => {
    const tasks = [created(task('first', 'a'), '2026-01-01'), created(task('second', 'a'), '2026-01-02'), created(task('third', 'a'), '2026-01-03')];
    const before = clientTree(snapshot(tasks, []));
    const running = clientTree(snapshot(tasks.map((item) => (item.id === 'first' ? { ...item, updatedAt: '2026-02-01' } : item)), [session('first', 'working')]));
    expect(titles(running[0]?.active ?? [])).toEqual(titles(before[0]?.active ?? []));
  });

  it('finds a task by its number', () => {
    const tree = clientTree(snapshot([{ ...task('Fix login', 'a'), number: 7 }, { ...task('Gallery', 'a'), number: 8 }], []), '#7');
    expect(titles(tree[0]?.active ?? [])).toEqual(['Fix login']);
  });

  it('searches tasks in every state, and hides clients with no match', () => {
    const tree = clientTree(snapshot([task('Fix login', 'a', 'done'), task('Gallery', 'b')], []), 'login');
    expect(tree.map((branch) => branch.company.id)).toEqual(['a']);
    expect(titles(tree[0]?.finished ?? [])).toEqual(['Fix login']);
  });
});

describe('archived tasks', () => {
  it('leave today and the waiting count', () => {
    const archived = { ...task('old', 'a'), archivedAt: '2026-01-03' };
    const input = snapshot([archived], [session('old', 'needs-input')]);
    expect(groupToday(input, null).waiting).toEqual([]);
    expect(waitingCount(input, 'a')).toBe(0);
  });

  it('say what state they are in', () => {
    const item = { company: company('a') };
    expect(taskStateText({ ...item, task: { ...task('x', 'a'), archivedAt: 'now' } })).toBe('Archived');
    expect(taskStateText({ ...item, task: task('x', 'a', 'done') })).toBe('Done');
    expect(taskStateText({ ...item, task: task('x', 'a', 'todo') })).toBe('Not started');
    expect(taskStateText({ ...item, task: task('x', 'a'), session: session('x', 'idle') })).toBe('Your turn');
  });
});

describe('sharedSubdomain', () => {
  const projects = [
    { id: '1', name: 'one', path: '/1', subdomainId: 'uploads' },
    { id: '2', name: 'two', path: '/2', subdomainId: 'uploads' },
    { id: '3', name: 'three', path: '/3', subdomainId: 'labs' },
  ];
  it('names the subdomain only when every chosen repository shares it', () => {
    expect(sharedSubdomain({ ...company('a'), projects }, ['1', '2'])).toBe('uploads');
    expect(sharedSubdomain({ ...company('a'), projects }, ['1', '3'])).toBeUndefined();
    expect(sharedSubdomain({ ...company('a'), projects }, [])).toBeUndefined();
  });
});

describe('inkOn', () => {
  it('picks readable text for light and dark client colors', () => {
    expect(inkOn('#E8A33D')).toBe('#14171f');
    expect(inkOn('#ffffff')).toBe('#14171f');
    expect(inkOn('#0b1f4d')).toBe('#ffffff');
    expect(inkOn('#000000')).toBe('#ffffff');
  });
});
