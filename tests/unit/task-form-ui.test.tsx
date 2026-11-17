// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewTaskPage } from '../../src/renderer/src/components/NewTaskPage';
import { startDraft } from '../../src/renderer/src/lib/new-task-draft';
import { TaskForm } from '../../src/renderer/src/components/TaskForm';
import { TaskRepositories } from '../../src/renderer/src/components/TaskRepositories';
import { TaskTree } from '../../src/renderer/src/components/TaskTree';
import type { TodayItem } from '../../src/renderer/src/lib/today';
import type { Bridge, Snapshot } from '../../src/shared/api';
import { companySchema, taskSchema, type Task } from '../../src/shared/schemas';

vi.mock('../../src/renderer/src/components/MarkdownField', () => ({
  MarkdownField: ({ label, value, onChange, onCommit }: { label: string; value: string; onChange: (value: string) => void; onCommit?: (value: string) => void }) => (
    <textarea aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} onBlur={(event) => onCommit?.(event.target.value)} />
  ),
}));
vi.mock('../../src/renderer/src/components/TerminalView', () => ({ TerminalView: () => <div data-testid="terminal" /> }));

const invoke = vi.fn();
const company = companySchema.parse({
  id: 'acme',
  name: 'Acme',
  color: '#5BB8A6',
  rootDir: '/code',
  projects: [{ id: 'api', name: 'api', path: '/code/api' }, { id: 'web', name: 'web', path: '/code/web' }],
});
const task = (change: Partial<Task> = {}) => taskSchema.parse({ id: 't', number: 4, companyId: 'acme', title: 'Export invoices', status: 'todo', isolated: true, createdAt: 'x', updatedAt: 'x', ...change });
const snapshotOf = (tasks: Task[], guideUsage: Record<string, number> = {}) =>
  ({
    companies: [company],
    tasks,
    sessions: [],
    reviews: {},
    accounts: { defaultAccountId: 'claude', accounts: [{ id: 'claude', name: 'Claude', type: 'claude-code', label: 'personal' }] },
    guideNewTasks: false,
    autoSendPrompt: true,
    guideUsage,
  }) as unknown as Snapshot;
const playbooks = [
  { id: 'implement', name: 'Implement a task', steps: [{ name: 'a', prompt: 'b' }], origin: 'built-in' },
  { id: 'bug', name: 'Investigate a bug', steps: [{ name: 'a', prompt: 'b' }], origin: 'built-in' },
  { id: 'rfc', name: 'Write an RFC', steps: [{ name: 'a', prompt: 'b' }], origin: 'built-in' },
];

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (method: string) => {
    if (method === 'listPlaybooks') return { playbooks, problems: [] };
    if (method === 'detectEditor') return 'Cursor';
    if (method === 'createTask') return task({ id: 'new' });
    if (method === 'readNotes') return '';
    if (method === 'listTaskOutputs' || method === 'taskChanges' || method === 'readSubagents') return [];
    return undefined;
  });
  window.hatstand = { invoke, on: () => () => {} } as unknown as Bridge;
});

afterEach(cleanup);

describe('the form of a task', () => {
  const renderForm = (onSubmit = vi.fn()) =>
    render(
      <TaskForm
        label="New task"
        title={{ value: 'Fix it', onChange: vi.fn() }}
        description=""
        improveRequest={{ key: 'k', companyId: 'acme', title: 'Fix it', description: '', projectIds: [] }}
        settings={<p>Settings here</p>}
        actions={<button>Create task</button>}
        onDescriptionChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

  it('holds the title and description in the main column, the settings beside them and the buttons at the bottom', () => {
    renderForm();
    const form = within(screen.getByRole('region', { name: 'New task' }));
    expect(form.getByLabelText('Task title').closest('.task-form-main')).toBeTruthy();
    expect(form.getByLabelText('Description').closest('.task-form-main')).toBeTruthy();
    expect(within(form.getByRole('complementary', { name: 'Settings of the task' })).getByText('Settings here')).toBeTruthy();
    expect(form.getByRole('button', { name: 'Create task' }).closest('footer.task-form-actions')).toBeTruthy();
  });

  it('creates the task with Enter in the title', async () => {
    const onSubmit = vi.fn();
    renderForm(onSubmit);
    await userEvent.type(screen.getByLabelText('Task title'), '{Enter}');
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

describe('the new task page', () => {
  it('lists the guides used most first', async () => {
    render(<NewTaskPage snapshot={snapshotOf([], { rfc: 4, bug: 1 })} initialDraft={startDraft(snapshotOf([], { rfc: 4, bug: 1 }), 'acme')} onCreated={vi.fn(async () => {})} onChanged={vi.fn(async () => {})} />);
    await screen.findByRole('option', { name: 'Write an RFC' });
    expect(within(screen.getByRole('combobox', { name: /^Guide/ })).getAllByRole('option').map((option) => option.textContent)).toEqual(['No guide', 'Write an RFC', 'Investigate a bug', 'Implement a task']);
  });

  it('creates the task with its agent and priority, and says the agent starts at once', async () => {
    const onCreated = vi.fn(async () => {});
    render(<NewTaskPage snapshot={snapshotOf([])} initialDraft={startDraft(snapshotOf([]), 'acme')} onCreated={onCreated} onChanged={vi.fn(async () => {})} />);
    expect(screen.getByText(/^The agent starts working on the task as soon as the session opens\./)).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Task title'), 'Export invoices');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Priority' }), 'high');
    await userEvent.click(screen.getByRole('button', { name: 'Create and start session' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new', 'acme'));
    expect(invoke).toHaveBeenCalledWith('createTask', expect.objectContaining({ title: 'Export invoices', accountId: 'claude', priority: 'high', isolated: true }));
    expect(invoke).toHaveBeenCalledWith('startSession', 'new');
  });
});

describe('the repositories of a task in its settings', () => {
  const renderRepos = (value: Task, isLive = false) => render(<TaskRepositories task={value} company={company} isLive={isLive} onChanged={vi.fn(async () => {})} />);

  it('opens each repository in the editor it found, by name', async () => {
    renderRepos(task({ projectIds: ['api'] }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open api in Cursor' }));
    expect(invoke).toHaveBeenCalledWith('openInEditor', 'acme', '/code/api');
    expect(screen.getByText('Only reading, until the agent needs to change it')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Open all/ })).toBeNull();
  });

  it('opens the copy of a repository, or the original, each at its own path', async () => {
    renderRepos(task({ projectIds: ['api', 'web'], worktrees: [{ projectId: 'api', path: '/copies/api', branch: 'hatstand/export', base: 'main' }, { projectId: 'web', path: '/copies/web', branch: 'hatstand/export', base: 'main' }] }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open the copy of api in Cursor' }));
    expect(invoke).toHaveBeenCalledWith('openInEditor', 'acme', '/copies/api');
    await userEvent.click(screen.getByRole('button', { name: 'Open the original api in Cursor' }));
    expect(invoke).toHaveBeenCalledWith('openInEditor', 'acme', '/code/api');
    await userEvent.click(screen.getByRole('button', { name: 'Open the copy of web in Cursor' }));
    expect(invoke).toHaveBeenCalledWith('openInEditor', 'acme', '/copies/web');
    expect(invoke.mock.calls.filter(([method]) => method === 'openInEditor').map(([, , path]) => path)).toEqual(['/copies/api', '/code/api', '/copies/web']);
    expect(screen.getAllByText('Copy on hatstand/export, from main')).toHaveLength(2);
  });

  it('names no editor when none is installed, and keeps the copy while the session runs', async () => {
    invoke.mockImplementation(async () => null);
    renderRepos(task({ projectIds: ['api'], worktrees: [{ projectId: 'api', path: '/copies/api', branch: 'b', base: 'main' }] }), true);
    expect(await screen.findByRole('button', { name: 'Open the copy of api in your editor' })).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Remove copy' }).disabled).toBe(true);
  });

  it('says where a task without repositories works', () => {
    renderRepos(task());
    expect(screen.getByText('No repository is selected. The agent starts in the client folder.')).toBeTruthy();
  });
});

describe('the tree of tasks', () => {
  const item = (id: string, guideName?: string): TodayItem => ({
    company,
    task: task({ id, title: `Task ${id}`, ...(guideName ? { guide: { playbookId: 'x', name: guideName, current: 0, promptPending: false, done: [], steps: [{ name: 'a', prompt: 'b' }] } } : {}) }),
  });

  it('shows the tasks under their guide, folds a guide away, and opens a task', async () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const { rerender } = render(<TaskTree label="Acme open tasks" items={[item('a'), item('b', 'Write an RFC')]} selectedTaskId="b" closed={[]} onToggle={onToggle} onSelect={onSelect} onMenu={vi.fn()} />);
    const rfc = within(screen.getByRole('group', { name: 'Write an RFC in Acme open tasks' }));
    expect(rfc.getByRole('button', { name: /Task b/ }).getAttribute('aria-current')).toBe('true');
    expect(within(screen.getByRole('group', { name: 'Not classified in Acme open tasks' })).getByRole('button', { name: /Task a/ })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /^Write an RFC/ }));
    expect(onToggle).toHaveBeenCalledWith('Acme open tasks:guide:x');
    rerender(<TaskTree label="Acme open tasks" items={[item('a'), item('b', 'Write an RFC')]} selectedTaskId={null} closed={['Acme open tasks:guide:x']} onToggle={onToggle} onSelect={onSelect} onMenu={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Task b/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Task a/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ task: expect.objectContaining({ id: 'a' }) }));
  });
});
