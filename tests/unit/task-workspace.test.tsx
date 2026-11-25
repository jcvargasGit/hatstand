// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientFiles } from '../../src/renderer/src/components/ClientFiles';
import { AccountsSection } from '../../src/renderer/src/components/AccountsSection';
import { ColorField } from '../../src/renderer/src/components/ColorField';
import { PlanningStep } from '../../src/renderer/src/components/PlanningStep';
import { ProjectTable } from '../../src/renderer/src/components/ProjectTable';
import { RemoveClientForm } from '../../src/renderer/src/components/RemoveClientForm';
import { RepositoriesStep } from '../../src/renderer/src/components/RepositoriesStep';
import { FlagsSection } from '../../src/renderer/src/components/FlagsSection';
import { SettingsPage } from '../../src/renderer/src/components/SettingsPage';
import { GuideSteps } from '../../src/renderer/src/components/GuideSteps';
import { GuidesStep } from '../../src/renderer/src/components/GuidesStep';
import { NewTaskPage } from '../../src/renderer/src/components/NewTaskPage';
import { startDraft } from '../../src/renderer/src/lib/new-task-draft';
import { SubagentActivity } from '../../src/renderer/src/components/SubagentActivity';
import { Sidebar } from '../../src/renderer/src/components/Sidebar';
import { TaskPanel } from '../../src/renderer/src/components/TaskPanel';
import type { SidebarLayout } from '../../src/renderer/src/hooks/useSidebarLayout';
import type { Bridge, Snapshot } from '../../src/shared/api';
import type { Company, Session, Task, TaskGuide } from '../../src/shared/schemas';
import { DEFAULT_FLAGS } from '../../src/shared/task-flags';

vi.mock('../../src/renderer/src/components/TerminalView', () => ({
  TerminalView: () => <div data-testid="terminal" />,
}));

const invoke = vi.fn();
Element.prototype.scrollIntoView = vi.fn();

const company: Company = {
  id: 'acme',
  name: 'Acme',
  color: '#E8A33D',
  origin: 'existing', hasCode: true, confirmedSteps: [],
  rootDir: '/code',
  skipPermissions: false,
  protectedPaths: [], links: [],
  subdomains: [{ id: 'uploads', name: 'Uploads', description: '', folders: [], links: [] }],
  projects: [
    { id: 'api', name: 'uploads-api', path: '/code/uploads-api', subdomainId: 'uploads' },
    { id: 'web', name: 'uploads-web', path: '/code/uploads-web', subdomainId: 'uploads' },
    { id: 'ops', name: 'ops', path: '/code/ops' },
  ],
  context: {},
};

const task = (overrides: Partial<Task> = {}): Task => ({
  isolated: false, worktrees: [], checklist: [], priority: 'none', note: '', 
  id: 't',
  companyId: 'acme',
  title: 'Fix login',
  description: '',
  projectIds: [],
  status: 'todo',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...overrides,
});

const snapshot = (tasks: Task[]): Snapshot => ({
  companies: [company],
  accounts: { defaultAccountId: 'c', accounts: [{ id: 'c', name: 'Claude', type: 'claude-code', label: 'personal' }] },
  tasks,
  sessions: [],
  reviews: {},
  todayLayout: 'list',
  guideNewTasks: true,
  guideUsage: {},
  autoSendPrompt: true,
  flags: DEFAULT_FLAGS,
  localKnowledge: [],
  localPlugin: [],
  starterInstructions: [],
  clientFolders: {},
});

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (method: string) => {
    if (method === 'createTask') return task({ id: 'new' });
    if (method === 'readNotes') return '';
    if (method === 'listTaskOutputs') return [];
    if (method === 'listPlaybooks') return { playbooks: [{ id: 'bug', name: 'Bug investigation', origin: 'built-in', steps: [{ name: 'Read' }] }], problems: [] };
    if (method === 'readSubagents') return [];
    return undefined;
  });
  window.hatstand = { invoke, on: () => () => {} } as unknown as Bridge;
});

afterEach(cleanup);

describe('NewTaskPage', () => {
  it('creates a task on several repositories, added by subdomain, and starts it', async () => {
    const onCreated = vi.fn(async () => {});
    render(<NewTaskPage snapshot={snapshot([])} initialDraft={startDraft(snapshot([]), 'acme')} onCreated={onCreated} onChanged={vi.fn(async () => {})} />);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Create and start session' }).disabled).toBe(true);

    await userEvent.type(screen.getByLabelText('Task title'), 'Fix login');
    await userEvent.click(screen.getByRole('button', { name: 'Choose repositories' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Choose repositories' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Add Uploads' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Use these 2 repositories' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(screen.getByRole('group', { name: 'Chosen repositories' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['uploads-api', 'uploads-web']);
    await userEvent.click(screen.getByRole('button', { name: 'Create and start session' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new', 'acme'));
    expect(invoke).toHaveBeenCalledWith('createTask', expect.objectContaining({ title: 'Fix login', projectIds: ['api', 'web'], subdomainId: 'uploads' }));
    expect(invoke).toHaveBeenCalledWith('startSession', 'new');
  });

  it('can create without starting, and works across the whole client by default', async () => {
    const onCreated = vi.fn(async () => {});
    render(<NewTaskPage snapshot={snapshot([])} initialDraft={startDraft(snapshot([]), 'acme')} onCreated={onCreated} onChanged={vi.fn(async () => {})} />);
    await userEvent.type(screen.getByLabelText('Task title'), 'Fix login');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledWith('createTask', expect.objectContaining({ projectIds: [] }));
    expect(invoke).not.toHaveBeenCalledWith('startSession', expect.anything());
  });

  const renderForm = (companies: Company[], initialCompanyId = companies[0]?.id ?? '') => {
    const data = { ...snapshot([]), companies };
    const onChanged = vi.fn(async () => {});
    render(<NewTaskPage snapshot={data} initialDraft={startDraft(data, initialCompanyId)} onCreated={vi.fn(async () => {})} onChanged={onChanged} />);
    return { onChanged };
  };
  const oneRepo: Company = { ...company, id: 'solo', name: 'Solo', subdomains: [], projects: [{ id: 'only', name: 'only', path: '/code/only' }] };

  const chosenRepos = () => within(screen.getByRole('group', { name: 'Chosen repositories' })).queryAllByRole('listitem').map((item) => item.textContent);

  it('selects the repository of a client that has only one', async () => {
    renderForm([oneRepo]);
    expect(chosenRepos()).toEqual(['only']);
  });

  it('selects no repository when the client has several', async () => {
    renderForm([company]);
    expect(chosenRepos()).toEqual([]);
    expect(screen.getByText('None selected. The agent starts in the client folder.')).toBeTruthy();
  });

  it('does not count a planning repository as the only one', async () => {
    const withPlanning: Company = { ...oneRepo, projects: [...oneRepo.projects, { id: 'plan', name: 'plan', path: '/code/plan' }], planning: { path: '/code/plan', places: [] } };
    renderForm([withPlanning]);
    expect(chosenRepos()).toEqual(['only']);
    await userEvent.click(screen.getByRole('button', { name: 'Change repositories' }));
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'only' }).checked).toBe(true);
    expect(screen.queryByRole('checkbox', { name: 'plan' })).toBeNull();
  });

  it('changes nothing when the repositories window is cancelled', async () => {
    renderForm([oneRepo]);
    await userEvent.click(screen.getByRole('button', { name: 'Change repositories' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'only' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(chosenRepos()).toEqual(['only']);
    await userEvent.click(screen.getByRole('button', { name: 'Change repositories' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'only' }));
    await userEvent.keyboard('{Escape}');
    expect(chosenRepos()).toEqual(['only']);
  });

  it('recalculates the repository and the guide when the client changes', async () => {
    renderForm([company, { ...oneRepo, defaultPlaybookId: 'bug' }], 'acme');
    const guide = screen.getByRole<HTMLSelectElement>('combobox', { name: /^Guide/ });
    expect(guide.value).toBe('');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Client' }), 'Solo');
    expect(chosenRepos()).toEqual(['only']);
    await waitFor(() => expect(guide.value).toBe('bug'));
  });

  it('starts with the default guide of the client, and respects choosing no guide', async () => {
    renderForm([{ ...company, defaultPlaybookId: 'bug' }]);
    const guide = screen.getByRole<HTMLSelectElement>('combobox', { name: /^Guide/ });
    await waitFor(() => expect(guide.value).toBe('bug'));
    await userEvent.selectOptions(guide, 'No guide');
    await userEvent.type(screen.getByLabelText('Task title'), 'No steps');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('createTask', expect.objectContaining({ playbookId: undefined })));
    expect(guide.value).toBe('');
  });

  it('ignores a default guide that no longer exists', async () => {
    renderForm([{ ...company, defaultPlaybookId: 'gone' }]);
    await screen.findByRole('option', { name: 'Bug investigation' });
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: /^Guide/ }).value).toBe('');
  });

  it('explains that a copy uses a git worktree', async () => {
    renderForm([company]);
    expect(screen.getByRole('option', { name: 'Copy on change (uses a git worktree)' })).toBeTruthy();
  });

  it('shows the area field without areas, and can create one without leaving the form', async () => {
    invoke.mockImplementation(async (method: string) => {
      if (method === 'createArea') return { id: 'new-area', name: 'Gallery' };
      if (method === 'listPlaybooks') return { playbooks: [], problems: [] };
      return undefined;
    });
    const { onChanged } = renderForm([oneRepo]);
    await userEvent.type(screen.getByLabelText('Task title'), 'Keep this draft');
    expect(screen.getByRole('combobox', { name: 'Area' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Create an area' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'New area name' }), 'Gallery{Enter}');
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('createArea', 'solo', 'Gallery'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(invoke).not.toHaveBeenCalledWith('createTask', expect.anything());
    expect(screen.getByLabelText<HTMLInputElement>('Task title').value).toBe('Keep this draft');
  });

  const repoInArea: Company = {
    ...oneRepo,
    subdomains: [{ id: 'uploads', name: 'Uploads', description: '', folders: [], links: [] }],
    projects: [{ id: 'only', name: 'only', path: '/code/only', subdomainId: 'uploads' }],
  };

  it('shows the area a task takes from its repository', async () => {
    renderForm([repoInArea]);
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Area' }).value).toBe('uploads');
    await userEvent.type(screen.getByLabelText('Task title'), 'In the area');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('createTask', expect.objectContaining({ subdomainId: 'uploads' })));
  });

  const withCore: Company = {
    ...repoInArea,
    defaultAreaId: 'core',
    subdomains: [{ id: 'core', name: 'Core', folder: 'core', description: '', folders: [], links: [] }, ...repoInArea.subdomains],
    projects: [{ id: 'only', name: 'only', path: '/code/only' }],
  };

  it('puts a task in the default area unless another one is chosen, and offers no empty choice', async () => {
    renderForm([withCore]);
    const area = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Area' });
    expect(area.value).toBe('core');
    expect(screen.queryByRole('option', { name: 'None' })).toBeNull();
    await userEvent.selectOptions(area, 'Uploads');
    await userEvent.type(screen.getByLabelText('Task title'), 'In uploads');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('createTask', expect.objectContaining({ title: 'In uploads', subdomainId: 'uploads' })));
  });

  it('offers no shortcut to create an area when the client already has some', async () => {
    renderForm([company]);
    expect(screen.queryByRole('button', { name: 'Create an area' })).toBeNull();
  });
});

describe('TaskPanel', () => {
  const onSentBack = vi.fn();
  const renderPanel = (value: Task, sessions: Session[] = []) => {
    const onChanged = vi.fn(async () => {});
    onSentBack.mockReset();
    render(<TaskPanel snapshot={{ ...snapshot([value]), sessions }} task={value} onChanged={onChanged} onOpenClient={vi.fn()} onSentBack={onSentBack} />);
    return onChanged;
  };

  it('sends an open task back to the backlog, then leaves the task', async () => {
    const onChanged = renderPanel(task({ status: 'doing' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send back to backlog' }));
    expect(invoke).toHaveBeenCalledWith('updateTask', 't', { status: 'idea' });
    await waitFor(() => expect(onSentBack).toHaveBeenCalledWith('acme'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('does not offer the backlog for a done or an archived task', () => {
    renderPanel(task({ status: 'done' }));
    expect(screen.queryByRole('button', { name: 'Send back to backlog' })).toBeNull();
    cleanup();
    renderPanel(task({ archivedAt: '2026-01-02' }));
    expect(screen.queryByRole('button', { name: 'Send back to backlog' })).toBeNull();
  });

  it('keeps a task with a running session out of the backlog', () => {
    renderPanel(task({ status: 'doing' }), [{ id: 's', taskId: 't', companyId: 'acme', accountId: 'c', cwd: '/', state: 'working', startedAt: '', updatedAt: '' }]);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send back to backlog' }).disabled).toBe(true);
  });

  it('improves the description of a created task, and saves only the description', async () => {
    const base = invoke.getMockImplementation();
    invoke.mockImplementation(async (method: string, ...args: unknown[]) => {
      if (method === 'descriptionInstructions') return 'Keep every fact.';
      return method === 'suggestDescription' ? { description: 'A fuller description' } : base?.(method, ...args);
    });
    renderPanel(task({ description: 'Old text', projectIds: ['api'] }));
    await userEvent.click(screen.getByRole('tab', { name: /Task settings/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Improve description' }));
    await userEvent.click(await within(await screen.findByRole('dialog', { name: 'Improve description' })).findByRole('button', { name: 'Send' }));
    const dialog = await screen.findByRole('dialog', { name: 'Suggested description' });
    expect(invoke).toHaveBeenCalledWith('suggestDescription', expect.objectContaining({ key: 't', title: 'Fix login', description: 'Old text', projectIds: ['api'], instructions: 'Keep every fact.' }));
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('updateTask', 't', { description: 'A fuller description' }));
  });

  it('asks before deleting, and cancel keeps the task', async () => {
    renderPanel(task());
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(invoke).not.toHaveBeenCalledWith('deleteTask', 't');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alert')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete task' }));
    expect(invoke).toHaveBeenCalledWith('deleteTask', 't');
  });

  it('archives and restores', async () => {
    renderPanel(task());
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(invoke).toHaveBeenCalledWith('updateTask', 't', { archivedAt: expect.any(String) });
    cleanup();
    renderPanel(task({ archivedAt: '2026-01-02' }));
    expect(screen.getAllByText('Archived').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Start session' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(invoke).toHaveBeenCalledWith('updateTask', 't', { archivedAt: undefined });
  });

  it('shows a done task as done, and reopens it', async () => {
    renderPanel(task({ status: 'done' }));
    expect(screen.getAllByText('Done').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(invoke).toHaveBeenCalledWith('updateTask', 't', { status: 'todo' });
  });

  it('renames with Enter, marks the name as chosen by a person, and ignores Escape or an empty name', async () => {
    renderPanel(task());
    await userEvent.click(screen.getByRole('button', { name: 'Rename task' }));
    await userEvent.clear(screen.getByLabelText('Task name'));
    await userEvent.keyboard('{Enter}');
    expect(invoke).not.toHaveBeenCalledWith('updateTask', 't', expect.anything());

    await userEvent.click(screen.getByRole('button', { name: 'Rename task' }));
    await userEvent.type(screen.getByLabelText('Task name'), 'Not this{Escape}');
    expect(invoke).not.toHaveBeenCalledWith('updateTask', 't', expect.anything());
    expect(screen.getByRole('heading', { name: 'Fix login' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Rename task' }));
    await userEvent.clear(screen.getByLabelText('Task name'));
    await userEvent.type(screen.getByLabelText('Task name'), 'Fix sign-in{Enter}');
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('updateTask', 't', { title: 'Fix sign-in', customTitle: true }));
  });

  it('opens on the overview, with the settings in their own view, and the terminal needs a session', async () => {
    renderPanel(task({ description: 'Users are logged out after a minute.', projectIds: ['api'] }));
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('tab', { name: 'Details' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Where this task is' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Changes' })).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('tab', { name: 'Terminal' }).disabled).toBe(true);
    await userEvent.click(screen.getByRole('tab', { name: 'Task settings' }));
    const settings = within(screen.getByRole('region', { name: 'Task settings' }));
    expect(settings.getByRole('button', { name: 'Description' })).toBeTruthy();
    expect(settings.getByRole('complementary', { name: 'Settings of the task' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Where this task is' })).toBeNull();
  });

  it('opens the settings with the shortcut of the tab', async () => {
    renderPanel(task());
    expect(screen.getByRole('tab', { name: 'Task settings' }).getAttribute('title')).toContain('2');
    fireEvent.keyDown(window, { key: '@', code: 'Digit2', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Task settings' }).getAttribute('aria-selected')).toBe('true'));
  });

  it('shows each piece of information in one tab only', async () => {
    const guide: TaskGuide = { playbookId: 'implement', name: 'Implement a task', current: 0, promptPending: false, done: [1], steps: [{ name: 'Read', prompt: 'a' }, { name: 'Fix', prompt: 'b' }] };
    renderPanel(task({ guide, description: 'Users are logged out after a minute.', projectIds: ['api'], checklist: [{ id: 'c1', text: 'Reproduce it', done: true }, { id: 'c2', text: 'Add a test', done: false }] }));
    const facts = within(screen.getByRole('region', { name: 'Where this task is' }));
    expect(facts.getByText(/Implement a task: Step 1 of 2, Read, 1 finished/)).toBeTruthy();
    expect(screen.getByText('Where it stands')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Checklist' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Changes' })).toBeTruthy();
    expect(screen.queryByText('Users are logged out after a minute.')).toBeNull();
    expect(screen.queryByRole('combobox', { name: /^Guide/ })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Chosen repositories' })).toBeNull();

    await userEvent.click(screen.getByRole('tab', { name: 'Task settings' }));
    const settings = within(screen.getByRole('region', { name: 'Task settings' }));
    expect(settings.getByText('Users are logged out after a minute.')).toBeTruthy();
    expect(settings.getByRole('combobox', { name: 'Type' })).toBeTruthy();
    expect(await settings.findByRole('combobox', { name: /^Guide/ })).toBeTruthy();
    expect(settings.getByRole('combobox', { name: /^Area/ })).toBeTruthy();
    expect(settings.getByRole('combobox', { name: /^Code/ })).toBeTruthy();
    expect(settings.getByRole('group', { name: 'Chosen repositories' })).toBeTruthy();
    expect(screen.queryByText('Where it stands')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Checklist' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Changes' })).toBeNull();
    const step = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Current step' });
    expect(within(step).getAllByRole('option').map((option) => option.textContent)).toEqual(['1. Read (finished)', '2. Fix']);
    await userEvent.selectOptions(step, '1');
    expect(invoke).toHaveBeenCalledWith('moveGuideStep', 't', 1);
  });

  it('saves each change of its settings at once', async () => {
    renderPanel(task({ projectIds: ['api'] }));
    await userEvent.click(screen.getByRole('tab', { name: 'Task settings' }));
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: /^Guide/ }), 'bug');
    expect(invoke).toHaveBeenCalledWith('setTaskGuide', 't', 'bug');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'investigation');
    expect(invoke).toHaveBeenCalledWith('updateTask', 't', { type: 'investigation' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Priority' }), 'high');
    expect(invoke).toHaveBeenCalledWith('updateTask', 't', { priority: 'high' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^Code/ }), 'own');
    expect(invoke).toHaveBeenCalledWith('updateTask', 't', { isolated: true });
    await userEvent.click(screen.getByRole('button', { name: 'Change repositories' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'uploads-web' }));
    await userEvent.click(screen.getByRole('button', { name: 'Use these 2 repositories' }));
    expect(invoke).toHaveBeenCalledWith('updateTask', 't', { projectIds: ['api', 'web'] });
  });
});

describe('Sidebar', () => {
  const layout = (overrides: Partial<SidebarLayout> = {}): SidebarLayout => ({
    collapsed: false,
    closedClients: [],
    needsYouHidden: false,
    width: 276,
    toggleCollapsed: vi.fn(),
    toggleClient: vi.fn(),
    openClient: vi.fn(),
    toggleNeedsYou: vi.fn(),
    setWidth: vi.fn(),
    resetWidth: vi.fn(),
    ...overrides,
  });
  const onChanged = vi.fn(async () => {});
  beforeEach(() => onChanged.mockClear());
  const renderSidebar = (tasks: Task[], value = layout(), client = company) => {
    const onNavigate = vi.fn();
    const onSelectTask = vi.fn();
    render(
      <Sidebar
        snapshot={{ ...snapshot(tasks), companies: [client] }}
        view={{ kind: 'today', companyId: null }}
        selectedTaskId={null}
        layout={value}
        onNavigate={onNavigate}
        onSelectTask={onSelectTask}
        onOpenSearch={vi.fn()}
        onChanged={onChanged}
      />,
    );
    return { onNavigate, onSelectTask };
  };

  it('starts a task with the guide of a group from its plus button', async () => {
    const rfc: TaskGuide = { playbookId: 'rfc', name: 'Write an RFC', current: 0, promptPending: false, done: [], steps: [{ name: 'a', prompt: 'x' }] };
    const { onNavigate } = renderSidebar([task({ id: 'a', title: 'First', guide: rfc }), task({ id: 'b', title: 'Second' })]);
    await userEvent.click(screen.getByRole('button', { name: 'New task with Write an RFC, in Acme open tasks' }));
    expect(onNavigate).toHaveBeenLastCalledWith({ kind: 'new-task', companyId: 'acme', playbookId: 'rfc' });
    await userEvent.click(screen.getByRole('button', { name: 'New task with no guide, in Acme open tasks' }));
    expect(onNavigate).toHaveBeenLastCalledWith({ kind: 'new-task', companyId: 'acme', playbookId: '' });
  });

  it('is as wide as the person left it, and its edge changes that width', () => {
    const value = layout({ width: 340 });
    renderSidebar([task()], value);
    expect(screen.getByRole('navigation', { name: 'Main' }).style.getPropertyValue('--sidebar-width')).toBe('340px');
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize sidebar' }), { key: 'ArrowRight' });
    expect(value.setWidth).toHaveBeenCalledWith(356);
  });

  it('has no edge to drag while it is collapsed', () => {
    renderSidebar([task()], layout({ collapsed: true }));
    expect(screen.queryByRole('separator')).toBeNull();
  });

  describe('the type of a task', () => {
    const guide = (playbookId: string, name: string): TaskGuide => ({ playbookId, name, current: 1, promptPending: false, done: [], steps: [{ name: 'a', prompt: 'x' }, { name: 'b', prompt: 'y' }] });

    it('names the type from the guide, with the step, and keeps the guide name as a tooltip', () => {
      renderSidebar([task({ id: 'a', title: 'Check the PR', guide: guide('pr-review', 'Review a pull request') })]);
      const tag = screen.getByText('PR review');
      expect(tag.getAttribute('title')).toBe('Review a pull request');
      expect(tag.closest('small')?.textContent).toBe('PR review, step 2 of 2');
      expect(screen.getByRole('button', { name: /^Review a pull request/ }).getAttribute('aria-expanded')).toBe('true');
    });

    it('prefers the type saved on the task', () => {
      renderSidebar([task({ id: 'a', title: 'Old', type: 'release', guide: guide('implement', 'Implement a task') })]);
      expect(screen.getByText('Release')).toBeTruthy();
    });

    it('counts a task with no guide as implementation in a client with code', () => {
      renderSidebar([task({ id: 'a', title: 'Plain' })]);
      expect(screen.getByText('Implementation')).toBeTruthy();
    });

    it('shows nothing when no type can be told', () => {
      renderSidebar([task({ id: 'a', title: 'Plain' })], layout(), { ...company, hasCode: false, projects: [] });
      expect(screen.getByRole('button', { name: /Plain/ }).querySelector('small')).toBeNull();
    });
  });

  it('nests tasks under their client, and keeps finished ones in their own group', async () => {
    const { onSelectTask } = renderSidebar([task({ id: 'a', title: 'Open one' }), task({ id: 'b', title: 'Finished one', status: 'done' })]);
    const branch = within(screen.getByRole('region', { name: 'Acme tasks' }));
    expect(branch.queryByRole('button', { name: /Finished one/ })).toBeNull();
    await userEvent.click(branch.getByRole('button', { name: 'Done and archived (1)' }));
    await userEvent.click(branch.getByRole('button', { name: /Finished one/ }));
    expect(onSelectTask).toHaveBeenCalledWith(expect.objectContaining({ task: expect.objectContaining({ id: 'b' }) }));
  });

  it('adds a task from the Tasks row of the client, not from the client row', async () => {
    const { onNavigate } = renderSidebar([]);
    const add = screen.getByRole('button', { name: 'New task for Acme' });
    const tasksRow = screen.getByRole('button', { name: 'Tasks of Acme' });
    expect(add.parentElement).toBe(tasksRow.parentElement);
    expect(add.closest('.tree-client-row')).toBeNull();
    await userEvent.click(add);
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'new-task', companyId: 'acme' });
  });

  it('shows the number of each task', () => {
    renderSidebar([task({ title: 'Fix login', number: 12 })]);
    expect(screen.getByRole('button', { name: /#12\s*Fix login/ })).toBeTruthy();
  });

  it('finds tasks by search, even inside a closed client', async () => {
    renderSidebar([task({ title: 'Fix login' }), task({ id: 'x', title: 'Gallery' })], layout({ closedClients: ['acme'] }));
    expect(screen.queryByRole('button', { name: /Fix login/ })).toBeNull();
    await userEvent.type(screen.getByLabelText('Filter tasks'), 'login');
    expect(screen.getByRole('button', { name: /Fix login/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Gallery/ })).toBeNull();
  });

  it('says in the tree which task needs an answer', () => {
    const value = task();
    const onNavigate = vi.fn();
    render(
      <Sidebar
        snapshot={{ ...snapshot([value]), sessions: [{ id: 's', taskId: 't', companyId: 'acme', accountId: 'c', cwd: '/', state: 'needs-input', startedAt: '', updatedAt: '' }] }}
        view={{ kind: 'today', companyId: null }}
        selectedTaskId={null}
        layout={layout()}
        onNavigate={onNavigate}
        onSelectTask={vi.fn()}
        onOpenSearch={vi.fn()}
        onChanged={onChanged}
      />,
    );
    expect(within(screen.getByRole('region', { name: 'Acme tasks' })).getByText('Needs your answer')).toBeTruthy();
  });

  describe('the Needs you list', () => {
    const waitingSession = (id: string, companyId: string): Session => ({ id: `s-${id}`, taskId: id, companyId, accountId: 'c', cwd: '/', state: 'needs-input', startedAt: '', updatedAt: '' });
    const other: Company = { ...company, id: 'other', name: 'Other' };
    const renderWaiting = (value: SidebarLayout) =>
      render(
        <Sidebar
          snapshot={{
            ...snapshot([task({ id: 'a', title: 'First' }), task({ id: 'b', companyId: 'other', title: 'Second' })]),
            companies: [other, company],
            sessions: [waitingSession('a', 'acme'), waitingSession('b', 'other')],
          }}
          view={{ kind: 'today', companyId: null }}
          selectedTaskId={null}
          layout={value}
          onNavigate={vi.fn()}
          onSelectTask={vi.fn()}
          onOpenSearch={vi.fn()}
          onChanged={onChanged}
        />,
      );

    it('groups tasks under their client, in the order of the clients, as the list of clients does', async () => {
      renderWaiting(layout());
      const list = within(screen.getByRole('region', { name: 'Needs you' }));
      const clients = list.getAllByRole('region');
      expect(clients.map((region) => region.getAttribute('aria-label'))).toEqual(['Other waiting for you', 'Acme waiting for you']);
      const acme = within(list.getByRole('region', { name: 'Acme waiting for you' }));
      expect(acme.getByRole('button', { name: /First/ })).toBeTruthy();
      expect(within(list.getByRole('region', { name: 'Other waiting for you' })).getByRole('button', { name: /Second/ })).toBeTruthy();
      const sameRow = (region: HTMLElement) => [...region.querySelectorAll('.tree-client-row > button')].map((button) => button.className);
      expect(sameRow(list.getByRole('region', { name: 'Acme waiting for you' }))).toEqual(sameRow(screen.getByRole('region', { name: 'Acme tasks' })).slice(0, 2));
      expect(acme.getByLabelText('1 waiting for you')).toBeTruthy();
      await userEvent.click(acme.getByRole('button', { name: 'Collapse Acme' }));
      expect(within(list.getByRole('region', { name: 'Acme waiting for you' })).queryByRole('button', { name: /First/ })).toBeNull();
    });

    it('shows the same tree as the list of clients: client, then guide, then tasks', () => {
      const rfc: TaskGuide = { playbookId: 'rfc', name: 'Write an RFC', current: 0, promptPending: false, done: [], steps: [{ name: 'a', prompt: 'x' }] };
      render(
        <Sidebar
          snapshot={{ ...snapshot([task({ id: 'a', title: 'First', guide: rfc }), task({ id: 'b', title: 'Second' }), task({ id: 'c', title: 'Third', guide: rfc })]), sessions: [waitingSession('a', 'acme'), waitingSession('b', 'acme')] }}
          view={{ kind: 'today', companyId: null }}
          selectedTaskId={null}
          layout={layout()}
          onNavigate={vi.fn()}
          onSelectTask={vi.fn()}
          onOpenSearch={vi.fn()}
          onChanged={onChanged}
        />,
      );
      const guidesOf = (region: HTMLElement) => [...region.querySelectorAll<HTMLElement>('.task-tree-guide')].map((group) => [group.querySelector('.task-tree-guide-name span')?.textContent, group.querySelectorAll('.tree-task').length]);
      const waiting = within(screen.getByRole('region', { name: 'Needs you' })).getByRole('region', { name: 'Acme waiting for you' });
      expect(guidesOf(waiting)).toEqual([['Write an RFC', 1], ['Not classified', 1]]);
      expect(guidesOf(screen.getByRole('region', { name: 'Acme tasks' }))).toEqual([['Write an RFC', 2], ['Not classified', 1]]);
      expect(within(waiting).getByRole('button', { name: /First/ })).toBeTruthy();
      expect(within(waiting).queryByRole('button', { name: /Third/ })).toBeNull();
    });

    it('hides the tasks but keeps the total, and its title toggles the list', async () => {
      const value = layout({ needsYouHidden: true });
      renderWaiting(value);
      const list = within(screen.getByRole('region', { name: 'Needs you' }));
      expect(list.queryByRole('group')).toBeNull();
      expect(list.queryByRole('button', { name: /First/ })).toBeNull();
      const toggle = list.getByRole('button', { name: /Needs you/ });
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(within(toggle).getByLabelText('2 waiting for you')).toBeTruthy();
      await userEvent.click(toggle);
      expect(value.toggleNeedsYou).toHaveBeenCalledOnce();
    });

    it('does not appear when nothing is waiting', () => {
      renderSidebar([task()]);
      expect(screen.queryByRole('region', { name: 'Needs you' })).toBeNull();
    });
  });

  it('collapses to icons, and opening a client brings the tree back', async () => {
    const value = layout({ collapsed: true });
    const { onNavigate } = renderSidebar([], value);
    expect(screen.queryByLabelText('Filter tasks')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Acme' }));
    expect(value.toggleCollapsed).toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'today', companyId: 'acme' });
  });

  it('opens settings from the bottom of the panel', async () => {
    const { onNavigate } = renderSidebar([]);
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'settings' });
  });

  describe('flagging a task', () => {
    const taskRow = (title: RegExp) => screen.getByRole('button', { name: title });
    const rowTitles = () => [...document.querySelectorAll('.tree-task-title')].map((title) => title.textContent);

    it('opens a menu with a right click, saves the chosen emoji and closes', async () => {
      renderSidebar([task({ title: 'Fix login' })]);
      expect(screen.queryByRole('menu')).toBeNull();
      fireEvent.contextMenu(taskRow(/Fix login/));
      const menu = within(screen.getByRole('menu', { name: 'Flag for Fix login' }));
      expect(menu.queryByRole('menuitem', { name: 'Remove flag' })).toBeNull();
      await userEvent.click(menu.getByRole('menuitemradio', { name: 'Flag with 🚩 Flagged' }));
      expect(invoke).toHaveBeenCalledWith('updateTask', 't', { flag: '🚩' });
      await waitFor(() => expect(onChanged).toHaveBeenCalled());
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('keeps only the first emoji of what is typed', async () => {
      renderSidebar([task({ title: 'Fix login' })]);
      fireEvent.contextMenu(taskRow(/Fix login/));
      await userEvent.type(screen.getByLabelText('Other emoji'), '🎯 soon{Enter}');
      expect(invoke).toHaveBeenCalledWith('updateTask', 't', { flag: '🎯' });
    });

    it('saves nothing when Enter is pressed on an empty field', async () => {
      renderSidebar([task({ title: 'Fix login' })]);
      fireEvent.contextMenu(taskRow(/Fix login/));
      await userEvent.type(screen.getByLabelText('Other emoji'), '   {Enter}');
      expect(invoke).not.toHaveBeenCalledWith('updateTask', 't', expect.anything());
      expect(screen.getByRole('menu')).toBeTruthy();
    });

    it('keeps an emoji the person typed in the list, and not one that is there already', async () => {
      renderSidebar([task()]);
      fireEvent.contextMenu(taskRow(/Fix login/));
      await userEvent.type(screen.getByLabelText('Other emoji'), '🎯{Enter}');
      expect(invoke).toHaveBeenCalledWith('setFlags', [...DEFAULT_FLAGS, { emoji: '🎯', name: '' }]);
      invoke.mockClear();
      fireEvent.contextMenu(taskRow(/Fix login/));
      await userEvent.type(screen.getByLabelText('Other emoji'), '🔥{Enter}');
      expect(invoke).toHaveBeenCalledWith('updateTask', 't', { flag: '🔥' });
      expect(invoke).not.toHaveBeenCalledWith('setFlags', expect.anything());
    });

    it('offers the flags of the person, with their names', () => {
      render(<Sidebar snapshot={{ ...snapshot([task()]), flags: [{ emoji: '🎯', name: 'Goal' }, { emoji: '🧪', name: '' }] }} view={{ kind: 'today', companyId: null }} selectedTaskId={null} layout={layout()} onNavigate={vi.fn()} onSelectTask={vi.fn()} onOpenSearch={vi.fn()} onChanged={vi.fn(async () => {})} />);
      fireEvent.contextMenu(taskRow(/Fix login/));
      expect(screen.getAllByRole('menuitemradio').map((item) => item.getAttribute('aria-label'))).toEqual(['Flag with 🎯 Goal', 'Flag with 🧪']);
      expect(screen.getByRole('menuitemradio', { name: 'Flag with 🎯 Goal' }).title).toBe('Goal');
    });

    it('shows the flag on the row, marks it in the menu and removes it', async () => {
      renderSidebar([task({ title: 'Fix login', flag: '🔥' })]);
      const row = taskRow(/Fix login/);
      expect(within(row).getByRole('img', { name: 'Flagged 🔥' })).toBeTruthy();
      expect(row.classList.contains('is-flagged')).toBe(true);
      expect(row.querySelector('.tree-task-title')?.textContent).toBe('Fix login');
      fireEvent.contextMenu(row);
      expect(screen.getByRole('menuitemradio', { name: 'Flag with 🔥 Urgent' }).getAttribute('aria-checked')).toBe('true');
      expect(screen.getByRole('menuitemradio', { name: 'Flag with 🚩 Flagged' }).getAttribute('aria-checked')).toBe('false');
      await userEvent.click(screen.getByRole('menuitem', { name: 'Remove flag' }));
      expect(invoke).toHaveBeenCalledWith('updateTask', 't', { flag: '' });
    });

    it('shows no flag on a task without one', () => {
      renderSidebar([task({ title: 'Fix login' })]);
      expect(taskRow(/Fix login/).classList.contains('is-flagged')).toBe(false);
      expect(screen.queryByRole('img', { name: /^Flagged/ })).toBeNull();
    });

    it('closes with Escape or a click outside, without saving', async () => {
      renderSidebar([task({ title: 'Fix login' })]);
      fireEvent.contextMenu(taskRow(/Fix login/));
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('menu')).toBeNull();
      fireEvent.contextMenu(taskRow(/Fix login/));
      fireEvent.mouseDown(screen.getByLabelText('Filter tasks'));
      expect(screen.queryByRole('menu')).toBeNull();
      expect(invoke).not.toHaveBeenCalledWith('updateTask', 't', expect.anything());
    });

    it('shows one menu at a time, for the task that was clicked last', () => {
      renderSidebar([task({ id: 'a', title: 'First' }), task({ id: 'b', title: 'Second' })]);
      fireEvent.contextMenu(taskRow(/First/));
      fireEvent.contextMenu(taskRow(/Second/));
      expect(screen.getAllByRole('menu').map((menu) => menu.getAttribute('aria-label'))).toEqual(['Flag for Second']);
    });

    it('keeps the order of the tasks when one is flagged', () => {
      const tasks = ['a', 'b', 'c'].map((id, index) => task({ id, title: `Task ${id}`, createdAt: `2026-01-0${index + 1}` }));
      renderSidebar(tasks);
      const plain = rowTitles();
      cleanup();
      renderSidebar(tasks.map((item) => (item.id === 'a' ? { ...item, flag: '🚩' } : item)));
      expect(rowTitles()).toEqual(plain);
      expect(plain).toEqual(['Task c', 'Task b', 'Task a']);
    });

    it('flags a waiting task from Needs you, and a finished one', async () => {
      const waiting: Session = { id: 's', taskId: 'a', companyId: 'acme', accountId: 'c', cwd: '/', state: 'needs-input', startedAt: '', updatedAt: '' };
      render(
        <Sidebar
          snapshot={{ ...snapshot([task({ id: 'a', title: 'Waiting one' }), task({ id: 'b', title: 'Finished one', status: 'done' })]), sessions: [waiting] }}
          view={{ kind: 'today', companyId: null }}
          selectedTaskId={null}
          layout={layout()}
          onNavigate={vi.fn()}
          onSelectTask={vi.fn()}
          onOpenSearch={vi.fn()}
          onChanged={onChanged}
        />,
      );
      fireEvent.contextMenu(within(screen.getByRole('region', { name: 'Needs you' })).getByRole('button', { name: /Waiting one/ }));
      await userEvent.click(screen.getByRole('menuitemradio', { name: 'Flag with ⭐ Important' }));
      expect(invoke).toHaveBeenCalledWith('updateTask', 'a', { flag: '⭐' });

      await userEvent.click(screen.getByRole('button', { name: 'Done and archived (1)' }));
      fireEvent.contextMenu(screen.getByRole('button', { name: /Finished one/ }));
      await userEvent.click(screen.getByRole('menuitemradio', { name: 'Flag with ✅ Ready' }));
      expect(invoke).toHaveBeenCalledWith('updateTask', 'b', { flag: '✅' });
    });
  });

  it('lists every open task of a client, with no limit', () => {
    renderSidebar(Array.from({ length: 12 }, (_, index) => task({ id: `t${index}`, title: `Open ${index}` })));
    const branch = within(screen.getByRole('region', { name: 'Acme tasks' }));
    expect(branch.getAllByRole('button', { name: /Open \d+/ })).toHaveLength(12);
    expect(branch.queryByRole('button', { name: /^Show \d+ more$/ })).toBeNull();
  });
});

describe('GuidesStep', () => {
  const guide = { name: 'Bug investigation', steps: [{ name: 'Look', prompt: 'Look' }] };
  const file = { path: '/guides/bug.yaml', name: 'bug.yaml', folder: '/guides', scope: 'guides' as const };

  const answerGuides = (customized: { value: boolean }) =>
    invoke.mockImplementation(async (method: string) => {
      if (method === 'listPlaybooks') {
        return { problems: [], playbooks: [customized.value ? { ...guide, id: 'bug', origin: 'customized', file: file.path } : { ...guide, id: 'bug', origin: 'built-in' }] };
      }
      if (method === 'listClientFiles') return customized.value ? [file] : [];
      if (method === 'readClientFile') return { content: 'name: Bug investigation', modifiedAt: 1 };
      if (method === 'customizePlaybook') {
        customized.value = true;
        return file.path;
      }
      if (method === 'removePlaybook') customized.value = false;
      return undefined;
    });

  it('opens the copy in the editor as soon as a guide is customized', async () => {
    answerGuides({ value: false });
    render(<GuidesStep company={company} onSave={vi.fn()} onOpenTask={vi.fn(async () => {})} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Customize Bug investigation' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('openClientFileInEditor', 'acme', file.path));
    expect(await screen.findByRole('region', { name: 'Preview of bug.yaml' })).toBeTruthy();
  });

  it('saves the default guide of the client', async () => {
    answerGuides({ value: false });
    const onSave = vi.fn();
    render(<GuidesStep company={company} onSave={onSave} onOpenTask={vi.fn(async () => {})} />);
    await screen.findByRole('option', { name: 'Bug investigation' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Default guide for new tasks/ }), 'Bug investigation');
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'acme', defaultPlaybookId: 'bug' }));
  });

  it('reopens a customized guide with Edit, and closes it when reset', async () => {
    answerGuides({ value: true });
    render(<GuidesStep company={company} onSave={vi.fn()} onOpenTask={vi.fn(async () => {})} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Bug investigation' }));
    await screen.findByRole('region', { name: 'Preview of bug.yaml' });
    await userEvent.click(screen.getByRole('button', { name: 'Reset Bug investigation' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm: use the built-in guide' }));
    await screen.findByRole('button', { name: 'Customize Bug investigation' });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Preview of bug.yaml' })).toBeNull());
  });
});

describe('ClientFiles', () => {
  const file = { path: '/kb/map.md', name: 'map.md', folder: '/kb', scope: 'knowledge' as const };

  const answerFiles = () =>
    invoke.mockImplementation(async (method: string) => {
      if (method === 'listClientFiles') return [file, { ...file, path: '/s/SKILL.md', name: 'SKILL.md', folder: '/s', scope: 'llm-config' }];
      if (method === 'readClientFile') return { content: '# Map', modifiedAt: 5 };
      if (method === 'createTask') return task({ id: 'edit' });
      return undefined;
    });

  it('shows only this scope, previews Markdown, and edits only in the editor', async () => {
    answerFiles();
    render(<ClientFiles companyId="acme" scope="knowledge" refreshKey="" onOpenTask={vi.fn(async () => {})} />);
    await userEvent.click(await screen.findByRole('button', { name: 'map.md' }));
    expect(screen.queryByRole('button', { name: 'SKILL.md' })).toBeNull();
    expect(await screen.findByRole('heading', { name: 'Map' })).toBeTruthy();

    expect(screen.queryByRole('textbox')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Open file' }));
    expect(invoke).toHaveBeenCalledWith('openClientFileInEditor', 'acme', '/kb/map.md');

    const reads = invoke.mock.calls.filter(([method]) => method === 'readClientFile').length;
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(invoke.mock.calls.filter(([method]) => method === 'readClientFile').length).toBeGreaterThan(reads));
  });

  it('hands a bigger change to an agent as a task', async () => {
    answerFiles();
    const onOpenTask = vi.fn(async () => {});
    render(<ClientFiles companyId="acme" scope="knowledge" refreshKey="" onOpenTask={onOpenTask} />);
    await userEvent.click(await screen.findByRole('button', { name: 'map.md' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ask an agent' }));
    expect(invoke).toHaveBeenCalledWith('createTask', expect.objectContaining({ companyId: 'acme', title: 'Update map.md' }));
    await waitFor(() => expect(onOpenTask).toHaveBeenCalledWith('edit'));
  });

  it('does not load remote images in a preview', async () => {
    invoke.mockImplementation(async (method: string) => {
      if (method === 'listClientFiles') return [file];
      if (method === 'readClientFile') return { content: '![logo](https://example.com/x.png)', modifiedAt: 5 };
      return undefined;
    });
    const { container } = render(<ClientFiles companyId="acme" scope="knowledge" refreshKey="" onOpenTask={vi.fn(async () => {})} />);
    await userEvent.click(await screen.findByRole('button', { name: 'map.md' }));
    expect(await screen.findByText('logo')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('GuideSteps', () => {
  const guide: TaskGuide = {
    playbookId: 'bug',
    name: 'Bug investigation',
    current: 1,
    promptPending: false,
    done: [],
    steps: [{ name: 'Read' }, { name: 'Sign in', you: 'Run the login yourself.' }, { name: 'Publish', approval: true, prompt: 'Publish.' }],
  };
  const session = (state: Session['state']): Session => ({ id: 's', taskId: 't', companyId: 'acme', accountId: 'c', cwd: '/', state, startedAt: '', updatedAt: '' });
  const show = (state?: Session['state'], value: Task = task()) => {
    const onChanged = vi.fn(async () => {});
    render(<GuideSteps task={value} guide={guide} session={state ? session(state) : undefined} onChanged={onChanged} />);
  };

  it('moves to the next step, and shows what the person has to do', async () => {
    show('idle');
    expect(screen.getByText(/Your part: Run the login yourself/)).toBeTruthy();
    expect(screen.getByLabelText('You do this step')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Sign in/ }).getAttribute('aria-current')).toBe('step');
    await userEvent.click(screen.getByRole('button', { name: 'Next step' }));
    expect(invoke).toHaveBeenCalledWith('moveGuideStep', 't', 2);
  });

  it.each(['working', 'needs-input'] as const)('does not type over an agent that is %s', (state) => {
    show(state);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Next step' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Publish/ }).disabled).toBe(true);
    expect(screen.getByText(/waiting for you at its prompt/)).toBeTruthy();
  });

  it('can jump to any step, and marks the step that needs approval', async () => {
    show();
    expect(screen.getByText('Needs your OK')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Read/ }));
    expect(invoke).toHaveBeenCalledWith('moveGuideStep', 't', 0);
  });

  it('stays still on a finished task', () => {
    show('idle', task({ status: 'done' }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Next step' }).disabled).toBe(true);
  });

  describe('a step the agent works on', () => {
    const publish: TaskGuide = { ...guide, current: 0, steps: [{ name: 'Read', prompt: 'Read.' }, { name: 'Fix', prompt: 'Fix.' }, { name: 'Post', approval: true, prompt: 'Post.' }] };
    const render3 = (live: Partial<Session> & Pick<Session, 'state'>, value: TaskGuide = publish) =>
      render(<GuideSteps task={task()} guide={value} session={{ ...session(live.state), ...live }} onChanged={vi.fn(async () => {})} />);
    const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });

    it('turns on continuing by itself for this task, and says where it stops', async () => {
      render3({ state: 'idle' });
      const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Continue by itself' });
      expect(box.checked).toBe(false);
      await userEvent.click(box);
      expect(invoke).toHaveBeenCalledWith('setGuideAutoContinue', 't', true);
    });

    it('says it sends the next steps by itself while the agent works on one', () => {
      render3({ state: 'idle' }, { ...publish, autoContinue: true });
      expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Continue by itself' }).checked).toBe(true);
      expect(screen.getByText(/sends each next step by itself/)).toBeTruthy();
    });

    it('says it stopped before the step that needs approval, which the person still sends', () => {
      render3({ state: 'idle' }, { ...publish, autoContinue: true, current: 1, done: [1, 2] });
      expect(screen.getByText(/step 3 needs your OK, so you send it/)).toBeTruthy();
      expect(button('Next step').disabled).toBe(false);
    });

    it('offers no continuing by itself once no step is left', () => {
      render3({ state: 'idle' }, { ...publish, current: 2, done: [1, 2, 3] });
      expect(screen.queryByRole('checkbox', { name: 'Continue by itself' })).toBeNull();
    });

    it('keeps Next step off when the turn ended without the agent saying the step is finished', () => {
      render3({ state: 'idle' });
      expect(button('Next step').disabled).toBe(true);
      expect(screen.getByText(/turns on when the agent says this step is finished/)).toBeTruthy();
      expect(button('2 Fix').disabled).toBe(false);
    });

    it('keeps Next step off when only a later step is finished, and says so', () => {
      render3({ state: 'idle' }, { ...publish, done: [2] });
      expect(button('Next step').disabled).toBe(true);
      expect(screen.getByText(/The agent also finished step 2/)).toBeTruthy();
      expect(button('2 Fix, finished')).toBeTruthy();
    });

    it('turns Next step on when the agent says this step is finished', async () => {
      render3({ state: 'idle' }, { ...publish, done: [1] });
      expect(button('1 Read, finished')).toBeTruthy();
      await userEvent.click(button('Next step'));
      expect(invoke).toHaveBeenCalledWith('moveGuideStep', 't', 1);
    });

    it('skips the steps the agent already finished while talking', async () => {
      render3({ state: 'idle' }, { ...publish, done: [1, 2] });
      expect(button('Next step').title).toBe('Step 3: Post');
      await userEvent.click(button('Next step'));
      expect(invoke).toHaveBeenCalledWith('moveGuideStep', 't', 2);
    });

    it('says when every step is finished, and offers no Next step', () => {
      render3({ state: 'idle' }, { ...publish, current: 1, done: [1, 2, 3] });
      expect(screen.queryByRole('button', { name: 'Next step' })).toBeNull();
      expect(screen.getByText('The agent finished every step of the guide.')).toBeTruthy();
    });

    it.each(['working', 'needs-input'] as const)('keeps Next step off while the agent is %s, even after its signal', (state) => {
      render3({ state }, { ...publish, done: [1] });
      expect(button('Next step').disabled).toBe(true);
    });

    it('sends the text instead of moving, and locks the steps until it is gone', async () => {
      render3({ state: 'idle', draft: true }, { ...publish, done: [1] });
      expect(screen.queryByRole('button', { name: 'Next step' })).toBeNull();
      expect(button('2 Fix').disabled).toBe(true);
      await userEvent.click(button('Send to agent'));
      expect(invoke).toHaveBeenCalledWith('sendDraft', 's');
      expect(invoke).not.toHaveBeenCalledWith('moveGuideStep', expect.anything(), expect.anything());
    });

    it.each(['working', 'needs-input'] as const)('does not send over an agent that is %s', (state) => {
      render3({ state, draft: true });
      expect(button('Send to agent').disabled).toBe(true);
      expect(screen.getByText(/send your text when the agent is waiting/)).toBeTruthy();
    });

    it('can send on the last step, which has no Next step', () => {
      render3({ state: 'idle', draft: true }, { ...publish, current: 2 });
      expect(button('Send to agent').disabled).toBe(false);
      expect(screen.getByText(/acts outside your computer/)).toBeTruthy();
    });

    it('shows no button on the last step without text', () => {
      render3({ state: 'idle' }, { ...publish, current: 2 });
      expect(screen.queryByRole('button', { name: 'Next step' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Send to agent' })).toBeNull();
    });

    it('ignores the text of a session that stopped', () => {
      render3({ state: 'stopped', draft: true });
      expect(screen.queryByRole('button', { name: 'Send to agent' })).toBeNull();
      expect(button('2 Fix').disabled).toBe(false);
    });
  });
});

describe('SubagentActivity', () => {
  const session: Session = { id: 's', taskId: 't', companyId: 'acme', accountId: 'c', cwd: '/', state: 'working', startedAt: '', updatedAt: '' };

  it('stays hidden until there is a subagent', async () => {
    const { container } = render(<SubagentActivity session={session} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('readSubagents', 's'));
    expect(container.firstChild).toBeNull();
  });

  it('counts subagents, and opens to show what each one did', async () => {
    invoke.mockImplementation(async () => [
      { id: '1', type: 'Explore', description: 'Find the login code', state: 'running' },
      { id: '2', type: 'Plan', description: '', state: 'finished', summary: 'Use the second option.' },
    ]);
    render(<SubagentActivity session={session} />);
    await userEvent.click(await screen.findByRole('button', { name: '2 subagents, 1 running' }));
    expect(screen.getByText('Find the login code')).toBeTruthy();
    expect(screen.getByLabelText('Running')).toBeTruthy();
    expect(screen.getByText('Use the second option.')).toBeTruthy();
  });
});

describe('ColorField', () => {
  it('saves a preset at once, and a custom color once it settles', async () => {
    const onChange = vi.fn();
    render(<ColorField value="#E8A33D" onChange={onChange} />);
    await userEvent.click(screen.getByLabelText('Color #5BB8A6'));
    expect(onChange).toHaveBeenCalledWith('#5BB8A6');

    onChange.mockClear();
    const custom = screen.getByLabelText('Custom color');
    fireEvent.change(custom, { target: { value: '#112233' } });
    fireEvent.change(custom, { target: { value: '#223344' } });
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith('#223344'));
    expect(screen.getByLabelText<HTMLInputElement>('Color #5BB8A6').checked).toBe(false);
  });
});

describe('the client folder', () => {
  it('offers the default only when another folder is in use', async () => {
    const { unmount } = render(<RepositoriesStep company={{ ...company, rootDir: '/other' }} defaultFolder="/code" onSave={vi.fn(async () => {})} onChanged={vi.fn(async () => {})} />);
    expect(screen.getByText('Default: /code')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Use default folder' }));
    expect(invoke).toHaveBeenCalledWith('resetClientFolder', 'acme');
    unmount();
    render(<RepositoriesStep company={company} defaultFolder="/code" onSave={vi.fn(async () => {})} onChanged={vi.fn(async () => {})} />);
    expect(screen.queryByRole('button', { name: 'Use default folder' })).toBeNull();
  });
});

describe('the flags in the settings', () => {
  const flags = [{ emoji: '🎯', name: 'Goal' }, { emoji: '🧪', name: '' }];
  const show = (value = flags) => {
    const onChanged = vi.fn(async () => {});
    render(<FlagsSection flags={value} onChanged={onChanged} />);
    return onChanged;
  };
  const saved = () => invoke.mock.calls.filter(([method]) => method === 'setFlags').map(([, list]) => list);

  it('renames a flag when leaving the field', async () => {
    const onChanged = show();
    const name = screen.getByLabelText('Name of 🧪');
    await userEvent.type(name, 'Experiment');
    expect(saved()).toEqual([]);
    fireEvent.blur(name);
    await waitFor(() => expect(saved()).toEqual([[flags[0], { emoji: '🧪', name: 'Experiment' }]]));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
  });

  it('changes the emoji of a flag, keeping only the first one typed', async () => {
    show();
    const emoji = screen.getByLabelText('Emoji of flag 1');
    fireEvent.change(emoji, { target: { value: '🏁 done' } });
    fireEvent.blur(emoji);
    await waitFor(() => expect(saved()).toEqual([[{ emoji: '🏁', name: 'Goal' }, flags[1]]]));
  });

  it('keeps the emoji a flag had when its field is left empty', async () => {
    show();
    const emoji = screen.getByLabelText<HTMLInputElement>('Emoji of flag 1');
    fireEvent.change(emoji, { target: { value: '' } });
    fireEvent.blur(emoji);
    expect(emoji.value).toBe('🎯');
    expect(saved()).toEqual([]);
  });

  it('adds a flag with its name, and not an emoji that is there already', async () => {
    show();
    const add = screen.getByRole<HTMLButtonElement>('button', { name: 'Add' });
    expect(add.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('New emoji'), '🎯');
    expect(add.disabled).toBe(true);
    await userEvent.clear(screen.getByLabelText('New emoji'));
    await userEvent.type(screen.getByLabelText('New emoji'), '📌');
    await userEvent.type(screen.getByLabelText('Name of the new flag'), 'Pinned{Enter}');
    await waitFor(() => expect(saved()).toEqual([[...flags, { emoji: '📌', name: 'Pinned' }]]));
    expect(screen.getByLabelText<HTMLInputElement>('New emoji').value).toBe('');
  });

  it('removes a flag, and puts back the ones Hatstand starts with', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Remove 🎯' }));
    await userEvent.click(screen.getByRole('button', { name: 'Put back the flags Hatstand starts with' }));
    await waitFor(() => expect(saved()).toEqual([[flags[1]], DEFAULT_FLAGS]));
  });

  it('offers nothing to put back while the list is the first one', () => {
    show(DEFAULT_FLAGS);
    expect(screen.queryByRole('button', { name: 'Put back the flags Hatstand starts with' })).toBeNull();
  });
});

describe('archiving and removing a client', () => {
  const settings = (companies: Company[]) => {
    const onChanged = vi.fn(async () => {});
    render(<SettingsPage snapshot={{ ...snapshot([]), companies }} onChanged={onChanged} onOpenClient={vi.fn()} onAddClient={vi.fn()} />);
    return onChanged;
  };

  it('archives first, and only an archived client can be removed', async () => {
    invoke.mockImplementation(async (method: string) => (method === 'listKeys' ? [] : undefined));
    settings([company]);
    expect(screen.queryByRole('region', { name: 'Archived clients' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Archive Acme' }));
    expect(invoke).toHaveBeenCalledWith('archiveClient', 'acme');
  });

  it('restores an archived client, and reports what a removal did', async () => {
    invoke.mockImplementation(async (method: string) => (method === 'removeClient' ? { keptFilesIn: '/home/removed/acme-1', protectionRemoved: [], protectionKept: [] } : undefined));
    settings([{ ...company, archivedAt: '2026-01-01' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(invoke).toHaveBeenCalledWith('restoreClient', 'acme');
    await userEvent.click(within(screen.getByRole('region', { name: 'Archived clients' })).getByRole('button', { name: 'Remove' }));
    await userEvent.type(screen.getByLabelText('Type Acme to confirm'), 'Acme');
    await userEvent.click(screen.getByRole('button', { name: 'Remove client' }));
    expect(invoke).toHaveBeenCalledWith('removeClient', 'acme', false);
    expect((await screen.findByRole('status')).textContent).toContain('/home/removed/acme-1');
  });

  it('needs the exact name, and says deleting is a separate choice', async () => {
    const onRemoved = vi.fn(async () => {});
    render(<RemoveClientForm company={company} onRemoved={onRemoved} onCancel={vi.fn()} />);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Remove client' }).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('Type Acme to confirm'), 'Acm');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Remove client' }).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('Type Acme to confirm'), 'e');
    await userEvent.click(screen.getByRole('radio', { name: /delete the files/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete client and files' }));
    expect(invoke).toHaveBeenCalledWith('removeClient', 'acme', true);
    expect(screen.getByText(/3 repositories stay/)).toBeTruthy();
  });
});

describe('creating a task', () => {
  it('lets you work without a copy of the code', async () => {
    invoke.mockImplementation(async (method: string) => (method === 'createTask' ? { id: 't' } : { playbooks: [], problems: [] }));
    const snapshot = { companies: [company], tasks: [], sessions: [], accounts: { accounts: [], defaultAccountId: undefined }, reviews: {} } as unknown as Snapshot;
    render(<NewTaskPage snapshot={snapshot} initialDraft={startDraft(snapshot, 'acme')} onCreated={vi.fn(async () => {})} onChanged={vi.fn(async () => {})} />);
    await userEvent.type(screen.getByRole('textbox', { name: /title/i }), 'Read only');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^Code/ }), 'shared');
    expect(screen.getByText(/No copy and no branch/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /^Create and start/ }));
    expect(invoke).toHaveBeenCalledWith('createTask', expect.objectContaining({ title: 'Read only', isolated: false }));
  });
});

describe('using a repository for planning', () => {
  const repoCompany = { ...company, projects: [{ id: 'specs', name: 'specs', path: '/specs' }] };

  it('can start from the list of repositories', async () => {
    invoke.mockImplementation(async () => ({ tool: null, isMonorepo: false, folders: [] }));
    const onChanged = vi.fn(async () => {});
    render(<ProjectTable company={repoCompany} onSave={vi.fn(async () => {})} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('button', { name: 'Use for planning' }));
    expect(invoke).toHaveBeenCalledWith('setPlanningRepo', 'acme', '/specs');
    expect(onChanged).toHaveBeenCalled();
  });

  it('can start from the planning step, and be undone', async () => {
    invoke.mockImplementation(async () => []);
    const onChanged = vi.fn(async () => {});
    const onSave = vi.fn(async () => {});
    const { unmount } = render(<PlanningStep company={repoCompany} defaultPath="/default" onSave={onSave} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('button', { name: 'Use this repository for planning' }));
    expect(invoke).toHaveBeenCalledWith('setPlanningRepo', 'acme', '/specs');
    unmount();
    render(<PlanningStep company={{ ...company, planning: { path: '/specs', places: [] } }} defaultPath="/default" onSave={onSave} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('button', { name: 'Move back to Repositories' }));
    const saved = onSave.mock.calls.at(-1) as unknown as [Company];
    expect(saved[0].planning).toBeUndefined();
    expect(saved[0].projects.at(-1)?.path).toBe('/specs');
  });
});

describe('splitting a repository by folder', () => {
  const repoCompany = { ...company, projects: [{ id: 'mono', name: 'mono', path: '/mono' }] };
  const layout = { tool: 'Nx', isMonorepo: true, folders: ['apps/a', 'apps/b'] };

  it('offers the split only when it finds a monorepo, and waits for you', async () => {
    invoke.mockImplementation(async () => layout);
    const onSave = vi.fn(async () => {});
    render(<ProjectTable company={repoCompany} onSave={onSave} onChanged={vi.fn(async () => {})} />);
    await screen.findByText('This looks like a monorepo (Nx), with 2 folders.');
    expect(onSave).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Split by folder' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ projects: [expect.objectContaining({ id: 'mono', splitByFolder: true })] }));
  });

  it('stays quiet for an ordinary repository, which can still be split by hand', async () => {
    invoke.mockImplementation(async () => ({ tool: null, isMonorepo: false, folders: ['src'] }));
    const onSave = vi.fn(async () => {});
    render(<ProjectTable company={repoCompany} onSave={onSave} onChanged={vi.fn(async () => {})} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('inspectRepoLayout', 'acme', 'mono'));
    expect(screen.queryByText(/looks like a monorepo/)).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Area for mono'), 'Several, by folder');
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ projects: [expect.objectContaining({ splitByFolder: true })] }));
  });

  it('assigns a folder to a subdomain, or to a new one named after it', async () => {
    invoke.mockImplementation(async () => layout);
    const onSave = vi.fn(async () => {});
    render(<ProjectTable company={{ ...repoCompany, projects: [{ id: 'mono', name: 'mono', path: '/mono', splitByFolder: true }] }} onSave={onSave} onChanged={vi.fn(async () => {})} />);
    await userEvent.selectOptions(await screen.findByLabelText('Area for apps/a'), 'Uploads');
    expect(onSave.mock.lastCall).toEqual([expect.objectContaining({ subdomains: [expect.objectContaining({ id: 'uploads', folders: [{ projectId: 'mono', path: 'apps/a' }] })] })]);
    await userEvent.selectOptions(screen.getByLabelText('Area for apps/b'), 'New: b');
    expect(onSave.mock.lastCall).toEqual([expect.objectContaining({ subdomains: expect.arrayContaining([expect.objectContaining({ name: 'b', folders: [{ projectId: 'mono', path: 'apps/b' }] })]) })]);
  });
});

describe('the planning step', () => {
  const offersDefault = async (method: string) => (method === 'defaultPlanningFolder' ? '/code/acme-planning' : []);

  it('creates a repository in the suggested folder', async () => {
    invoke.mockImplementation(offersDefault);
    const onChanged = vi.fn(async () => {});
    render(<PlanningStep company={company} defaultPath="/default" onSave={vi.fn(async () => {})} onChanged={onChanged} />);
    await waitFor(() => expect(screen.getByLabelText('Folder for the new planning repository')).toHaveProperty('value', '/code/acme-planning'));
    await userEvent.click(screen.getByRole('button', { name: 'Create repository' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('createPlanningRepo', 'acme', '/code/acme-planning'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('respects a folder you type, and shows why it could not create it', async () => {
    invoke.mockImplementation(async (method: string) => {
      if (method === 'createPlanningRepo') throw new Error('Git has no commit email for /elsewhere.');
      return offersDefault(method);
    });
    render(<PlanningStep company={company} defaultPath="/default" onSave={vi.fn(async () => {})} onChanged={vi.fn(async () => {})} />);
    const folder = screen.getByLabelText('Folder for the new planning repository');
    await waitFor(() => expect(folder).toHaveProperty('value', '/code/acme-planning'));
    await userEvent.clear(folder);
    await userEvent.type(folder, '/elsewhere/plans');
    await userEvent.click(screen.getByRole('button', { name: 'Create repository' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('createPlanningRepo', 'acme', '/elsewhere/plans'));
    await screen.findByText(/no commit email/);
  });

  it('warns before creating when the default folder has files, and creates only after you confirm', async () => {
    invoke.mockImplementation(async (method: string) => {
      if (method === 'folderSwitchImpact') return { files: 2, from: '/default', openTasks: 0 };
      return offersDefault(method);
    });
    render(<PlanningStep company={company} defaultPath="/default" onSave={vi.fn(async () => {})} onChanged={vi.fn(async () => {})} />);
    await waitFor(() => expect(screen.getByLabelText('Folder for the new planning repository')).toHaveProperty('value', '/code/acme-planning'));
    await userEvent.click(screen.getByRole('button', { name: 'Create repository' }));
    await screen.findByText(/2 files in \/default will stop being used/);
    expect(invoke).not.toHaveBeenCalledWith('createPlanningRepo', 'acme', '/code/acme-planning');
    await userEvent.click(screen.getByRole('button', { name: 'Use the new folder' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('createPlanningRepo', 'acme', '/code/acme-planning'));
  });

  it('does not offer to create one when the client has one', () => {
    invoke.mockImplementation(offersDefault);
    render(<PlanningStep company={{ ...company, planning: { path: '/specs', places: [] } }} defaultPath="/default" onSave={vi.fn(async () => {})} onChanged={vi.fn(async () => {})} />);
    expect(screen.queryByRole('button', { name: 'Create repository' })).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith('defaultPlanningFolder', 'acme');
  });

  it('sends the chosen folder to be checked in the main process', async () => {
    invoke.mockImplementation(async () => []);
    const onChanged = vi.fn(async () => {});
    render(<PlanningStep company={company} defaultPath="/default" onSave={vi.fn(async () => {})} onChanged={onChanged} />);
    expect(screen.queryByText('Where each thing goes')).toBeNull();
    invoke.mockImplementation(async (method: string) => (method === 'resolvePath' ? '/specs' : []));
    await userEvent.type(screen.getByLabelText('Planning folder, full path'), '/specs');
    await userEvent.click(screen.getByRole('button', { name: 'Add path' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('setPlanningRepo', 'acme', '/specs'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('edits where things go, and skips a place that is not finished', async () => {
    invoke.mockImplementation(async () => []);
    const onSave = vi.fn(async () => {});
    const planning = { path: '/specs', places: [{ name: 'Tickets', folder: 'backlog' }] };
    render(<PlanningStep company={{ ...company, planning }} defaultPath="/default" onSave={onSave} onChanged={vi.fn(async () => {})} />);
    await userEvent.clear(screen.getByLabelText('Folder of place 1'));
    await userEvent.type(screen.getByLabelText('Folder of place 1'), 'tickets');
    await userEvent.click(screen.getByRole('button', { name: 'Add a place' }));
    await userEvent.type(screen.getByLabelText('Name of place 2'), 'RFCs');
    await userEvent.tab();
    expect(onSave.mock.lastCall).toEqual([expect.objectContaining({ planning: { path: '/specs', places: [{ name: 'Tickets', folder: 'tickets' }] } })]);
    await userEvent.click(screen.getByRole('button', { name: 'Go back to the default folder' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Use the default folder' }));
    await waitFor(() => expect(onSave.mock.lastCall).toEqual([expect.objectContaining({ planning: undefined })]));
  });
});

describe('accounts in settings', () => {
  it('shows who an account is for, and keeps one account that every client can use', () => {
    const accounts = {
      defaultAccountId: 'shared',
      accounts: [
        { id: 'shared', name: 'Shared', type: 'claude-code' as const, label: 'personal' as const },
        { id: 'own', name: 'Own', type: 'claude-code' as const, label: 'company' as const, companyId: 'acme' },
      ],
    };
    render(<AccountsSection snapshot={{ ...snapshot([]), accounts }} onChanged={vi.fn(async () => {})} />);
    expect(screen.getByText(/only for Acme/)).toBeTruthy();
    const removes = screen.getAllByRole<HTMLButtonElement>('button', { name: 'Remove' });
    expect(removes.map((button) => button.disabled)).toEqual([true, false]);
    expect(screen.queryByRole('button', { name: 'Make default' })).toBeNull();
  });
});
