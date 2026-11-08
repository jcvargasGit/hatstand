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
import { SettingsPage } from '../../src/renderer/src/components/SettingsPage';
import { GuideSteps } from '../../src/renderer/src/components/GuideSteps';
import { GuidesStep } from '../../src/renderer/src/components/GuidesStep';
import { NewTaskPage } from '../../src/renderer/src/components/NewTaskPage';
import { SubagentActivity } from '../../src/renderer/src/components/SubagentActivity';
import { Sidebar } from '../../src/renderer/src/components/Sidebar';
import { TaskPanel } from '../../src/renderer/src/components/TaskPanel';
import type { SidebarLayout } from '../../src/renderer/src/hooks/useSidebarLayout';
import type { Bridge, Snapshot } from '../../src/shared/api';
import type { Company, Session, Task, TaskGuide } from '../../src/shared/schemas';

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
    render(<NewTaskPage snapshot={snapshot([])} initialCompanyId="acme" onCreated={onCreated} onChanged={vi.fn(async () => {})} />);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Create and start session' }).disabled).toBe(true);

    await userEvent.type(screen.getByLabelText('Task title'), 'Fix login');
    await userEvent.click(screen.getByRole('button', { name: 'Add Uploads' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create and start session' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new', 'acme'));
    expect(invoke).toHaveBeenCalledWith('createTask', expect.objectContaining({ title: 'Fix login', projectIds: ['api', 'web'], subdomainId: 'uploads' }));
    expect(invoke).toHaveBeenCalledWith('startSession', 'new');
  });

  it('can create without starting, and works across the whole client by default', async () => {
    const onCreated = vi.fn(async () => {});
    render(<NewTaskPage snapshot={snapshot([])} initialCompanyId="acme" onCreated={onCreated} onChanged={vi.fn(async () => {})} />);
    await userEvent.type(screen.getByLabelText('Task title'), 'Fix login');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledWith('createTask', expect.objectContaining({ projectIds: [] }));
    expect(invoke).not.toHaveBeenCalledWith('startSession', expect.anything());
  });

  const renderForm = (companies: Company[], initialCompanyId = companies[0]?.id ?? '') => {
    const data = { ...snapshot([]), companies };
    const onChanged = vi.fn(async () => {});
    render(<NewTaskPage snapshot={data} initialCompanyId={initialCompanyId} onCreated={vi.fn(async () => {})} onChanged={onChanged} />);
    return { onChanged };
  };
  const oneRepo: Company = { ...company, id: 'solo', name: 'Solo', subdomains: [], projects: [{ id: 'only', name: 'only', path: '/code/only' }] };

  it('selects the repository of a client that has only one', async () => {
    renderForm([oneRepo]);
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'only' }).checked).toBe(true);
  });

  it('selects no repository when the client has several', async () => {
    renderForm([company]);
    expect(screen.getAllByRole<HTMLInputElement>('checkbox').filter((box) => box.checked)).toEqual([]);
  });

  it('does not count a planning repository as the only one', async () => {
    const withPlanning: Company = { ...oneRepo, projects: [...oneRepo.projects, { id: 'plan', name: 'plan', path: '/code/plan' }], planning: { path: '/code/plan', places: [] } };
    renderForm([withPlanning]);
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'only' }).checked).toBe(true);
    expect(screen.queryByRole('checkbox', { name: 'plan' })).toBeNull();
  });

  it('recalculates the repository and the guide when the client changes', async () => {
    renderForm([company, { ...oneRepo, defaultPlaybookId: 'bug' }], 'acme');
    const guide = screen.getByRole<HTMLSelectElement>('combobox', { name: /^Guide/ });
    expect(guide.value).toBe('');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Client' }), 'Solo');
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'only' }).checked).toBe(true);
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
  const renderPanel = (value: Task) => {
    const onChanged = vi.fn(async () => {});
    render(<TaskPanel snapshot={snapshot([value])} task={value} onChanged={onChanged} onOpenClient={vi.fn()} />);
    return onChanged;
  };

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

  it('opens on the overview, with details in their own view, and the terminal needs a session', async () => {
    renderPanel(task());
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('region', { name: 'Where this task is' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Where it stands' })).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('tab', { name: 'Terminal' }).disabled).toBe(true);
    await userEvent.click(screen.getByRole('tab', { name: 'Details' }));
    expect(screen.getByRole('region', { name: 'Where it stands' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Where it stands' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Where this task is' })).toBeNull();
  });
});

describe('Sidebar', () => {
  const layout = (overrides: Partial<SidebarLayout> = {}): SidebarLayout => ({
    collapsed: false,
    closedClients: [],
    needsYouHidden: false,
    toggleCollapsed: vi.fn(),
    toggleClient: vi.fn(),
    openClient: vi.fn(),
    toggleNeedsYou: vi.fn(),
    ...overrides,
  });
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
      />,
    );
    return { onNavigate, onSelectTask };
  };

  describe('the type of a task', () => {
    const guide = (playbookId: string, name: string): TaskGuide => ({ playbookId, name, current: 1, promptPending: false, steps: [{ name: 'a', prompt: 'x' }, { name: 'b', prompt: 'y' }] });

    it('names the type from the guide, with the step, and keeps the guide name as a tooltip', () => {
      renderSidebar([task({ id: 'a', title: 'Check the PR', guide: guide('pr-review', 'Review a pull request') })]);
      const tag = screen.getByText('PR review');
      expect(tag.getAttribute('title')).toBe('Review a pull request');
      expect(tag.closest('small')?.textContent).toBe('PR review, step 2 of 2');
      expect(screen.queryByText(/Review a pull request/)).toBeNull();
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
        />,
      );

    it('groups tasks under their client, in the order of the clients', () => {
      renderWaiting(layout());
      const list = within(screen.getByRole('region', { name: 'Needs you' }));
      expect(list.getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['Other', 'Acme']);
      expect(within(list.getByRole('group', { name: 'Acme' })).getByRole('button', { name: /First/ })).toBeTruthy();
      expect(within(list.getByRole('group', { name: 'Other' })).getByRole('button', { name: /Second/ })).toBeTruthy();
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

    it('keeps Next step off when the turn ended without the agent saying the step is finished', () => {
      render3({ state: 'idle' });
      expect(button('Next step').disabled).toBe(true);
      expect(screen.getByText(/turns on when the agent says this step is finished/)).toBeTruthy();
      expect(button('2 Fix').disabled).toBe(false);
    });

    it('ignores a signal left by another step', () => {
      render3({ state: 'idle', stepDone: 2 });
      expect(button('Next step').disabled).toBe(true);
    });

    it('turns Next step on when the agent says this step is finished', async () => {
      render3({ state: 'idle', stepDone: 1 });
      await userEvent.click(button('Next step'));
      expect(invoke).toHaveBeenCalledWith('moveGuideStep', 't', 1);
    });

    it.each(['working', 'needs-input'] as const)('keeps Next step off while the agent is %s, even after its signal', (state) => {
      render3({ state, stepDone: 1 });
      expect(button('Next step').disabled).toBe(true);
    });

    it('sends the text instead of moving, and locks the steps until it is gone', async () => {
      render3({ state: 'idle', draft: true, stepDone: 1 });
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

describe('archiving and removing a client', () => {
  const settings = (companies: Company[]) => {
    const onChanged = vi.fn(async () => {});
    render(<SettingsPage snapshot={{ ...snapshot([]), companies }} onChanged={onChanged} onOpenClient={vi.fn()} onAddClient={vi.fn()} />);
    return onChanged;
  };

  it('archives first, and only an archived client can be removed', async () => {
    invoke.mockImplementation(async (method: string) => (method === 'listSecretNames' ? [] : undefined));
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
    render(<NewTaskPage snapshot={snapshot} initialCompanyId="acme" onCreated={vi.fn(async () => {})} onChanged={vi.fn(async () => {})} />);
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
