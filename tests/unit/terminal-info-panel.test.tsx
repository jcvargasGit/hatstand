// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bridge, Snapshot } from '../../src/shared/api';
import type { Company, Session, SessionState, Task } from '../../src/shared/schemas';
import { TaskPanel } from '../../src/renderer/src/components/TaskPanel';
import { FILES_REFRESH_MS, TerminalInfoPanel } from '../../src/renderer/src/components/TerminalInfoPanel';

vi.mock('../../src/renderer/src/components/MarkdownEditor', () => ({
  MarkdownEditor: ({ initialValue, label, onChange, onBlur }: { initialValue: string; label: string; onChange: (value: string) => void; onBlur: () => void }) => (
    <textarea aria-label={label} defaultValue={initialValue} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />
  ),
}));
vi.mock('../../src/renderer/src/components/TerminalView', () => ({
  TerminalView: ({ focusRequest }: { focusRequest: number }) => <div data-testid="terminal" data-focus={focusRequest} />,
}));

const invoke = vi.fn();
const session = (state: SessionState = 'idle'): Session => ({ id: 's', taskId: 't', companyId: 'acme', accountId: 'c', cwd: '/code', state, startedAt: '2026-01-01', updatedAt: '2026-01-01' });
const SUMMARY = '## TL;DR\nThe plan is ready.\n\n## Last done\nWrote it.\n\n## Pending\nNothing\n';

const company: Company = {
  id: 'acme',
  name: 'Acme',
  color: '#E8A33D',
  origin: 'existing',
  hasCode: true,
  confirmedSteps: [],
  rootDir: '/code',
  skipPermissions: false,
  protectedPaths: [],
  links: [],
  subdomains: [],
  projects: [{ id: 'api', name: 'api', path: '/code/api' }],
  context: {},
};
const task: Task = { id: 't', companyId: 'acme', title: 'Fix login', description: '', note: '', status: 'doing', projectIds: [], checklist: [], priority: 'none', isolated: false, worktrees: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' };
const renderPanel = (state: SessionState = 'idle', notes = SUMMARY, value: Task = task) => render(<TerminalInfoPanel task={value} company={company} session={session(state)} notes={notes} onLeave={vi.fn()} />);
const updateButton = () => screen.getByRole<HTMLButtonElement>('button', { name: /Update/ });

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (method: string) => {
    if (method === 'readTaskNote') return 'saved note';
    if (method === 'readNotes') return SUMMARY;
    if (method === 'listPlaybooks') return { playbooks: [], problems: [] };
    if (method === 'readSubagents' || method === 'listTaskOutputs' || method === 'taskChanges') return [];
    return undefined;
  });
  window.hatstand = { invoke, on: () => () => {} } as unknown as Bridge;
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the note in the panel beside the terminal', () => {
  it('opens with the saved text', async () => {
    renderPanel();
    expect((await screen.findByLabelText<HTMLTextAreaElement>('Task note')).value).toBe('saved note');
  });

  it('has the formatting toolbar, with the switch to the Markdown source', async () => {
    renderPanel();
    await screen.findByLabelText('Task note');
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' });
    expect(within(toolbar).getByRole('button', { name: 'Bold' })).toBeTruthy();
    expect(within(toolbar).getByRole('button', { name: 'Markdown' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('saves after a pause in the typing, once', async () => {
    renderPanel();
    const editor = await screen.findByLabelText('Task note');
    vi.useFakeTimers();
    fireEvent.change(editor, { target: { value: 'a' } });
    fireEvent.change(editor, { target: { value: 'ab' } });
    act(() => vi.advanceTimersByTime(400));
    expect(invoke).not.toHaveBeenCalledWith('saveTaskNote', 't', expect.anything());
    act(() => vi.advanceTimersByTime(200));
    expect(invoke.mock.calls.filter(([method]) => method === 'saveTaskNote')).toEqual([['saveTaskNote', 't', 'ab']]);
  });

  it('saves when leaving the field, and when the panel closes', async () => {
    const { unmount } = renderPanel();
    const editor = await screen.findByLabelText('Task note');
    fireEvent.change(editor, { target: { value: 'left' } });
    fireEvent.blur(editor);
    expect(invoke).toHaveBeenCalledWith('saveTaskNote', 't', 'left');
    fireEvent.change(editor, { target: { value: 'closed' } });
    unmount();
    expect(invoke).toHaveBeenCalledWith('saveTaskNote', 't', 'closed');
  });

  it('shows no editor if the note could not be read, so it cannot overwrite it', async () => {
    invoke.mockImplementation(async (method: string) => {
      if (method === 'readTaskNote') throw new Error('Could not read the task.');
      return undefined;
    });
    renderPanel('idle', '');
    await screen.findByText('Could not read the task.');
    expect(screen.queryByLabelText('Task note')).toBeNull();
  });
});

describe('the TL;DR of the panel', () => {
  it('shows what the agent saved, apart from the note', async () => {
    renderPanel();
    await screen.findByLabelText('Task note');
    screen.getByText('The plan is ready.');
    screen.getByText('Wrote it.');
  });

  it('says so when the agent has no summary yet', async () => {
    renderPanel('idle', '');
    await screen.findByLabelText('Task note');
    screen.getByText('The agent has not written a summary yet.');
  });

  it.each<[SessionState, boolean]>([
    ['idle', true],
    ['background', true],
    ['working', false],
    ['needs-input', false],
    ['stopped', false],
  ])('in the state %s, the button can be used: %s', async (state, usable) => {
    renderPanel(state);
    await screen.findByLabelText('Task note');
    expect(updateButton().disabled).toBe(!usable);
  });

  it('waits while text is left at the agent prompt', async () => {
    render(<TerminalInfoPanel task={task} company={company} session={{ ...session(), draft: true }} notes={SUMMARY} onLeave={vi.fn()} />);
    await screen.findByLabelText('Task note');
    expect(updateButton().disabled).toBe(true);
    expect(updateButton().title).toContain('still in the terminal');
  });

  it('asks the agent and shows it is updating until the notes change', async () => {
    const view = renderPanel();
    await screen.findByLabelText('Task note');
    await userEvent.click(updateButton());
    expect(invoke).toHaveBeenCalledWith('refreshTaskSummary', 't');
    await screen.findByRole('button', { name: 'Updating…' });
    view.rerender(<TerminalInfoPanel task={task} company={company} session={session()} notes="## TL;DR\nNew." onLeave={vi.fn()} />);
    await screen.findByRole('button', { name: 'Update' });
  });

  it('stops showing it is updating when the turn ends with the same notes', async () => {
    const view = renderPanel();
    await screen.findByLabelText('Task note');
    await userEvent.click(updateButton());
    await screen.findByRole('button', { name: 'Updating…' });
    view.rerender(<TerminalInfoPanel task={task} company={company} session={session('working')} notes={SUMMARY} onLeave={vi.fn()} />);
    view.rerender(<TerminalInfoPanel task={task} company={company} session={session('idle')} notes={SUMMARY} onLeave={vi.fn()} />);
    await screen.findByRole('button', { name: 'Update' });
  });

  it('shows why the request could not be sent', async () => {
    invoke.mockImplementation(async (method: string) => {
      if (method === 'readTaskNote') return '';
      if (method === 'refreshTaskSummary') throw new Error('The agent is busy or asking you something.');
      return undefined;
    });
    renderPanel();
    await screen.findByLabelText('Task note');
    await userEvent.click(updateButton());
    await screen.findByText('The agent is busy or asking you something.');
    expect(updateButton().disabled).toBe(false);
  });
});

describe('showing and hiding the panel in the task', () => {
  const snapshot = { companies: [company], accounts: { defaultAccountId: 'c', accounts: [{ id: 'c', name: 'Claude', type: 'claude-code', label: 'personal' }] }, tasks: [task], sessions: [session()], reviews: {} } as unknown as Snapshot;
  const renderTask = () => render(<TaskPanel snapshot={snapshot} task={task} onChanged={vi.fn(async () => {})} onOpenClient={vi.fn()} onSentBack={vi.fn()} />);

  it('hides it, gives the keyboard back to the terminal and remembers the choice', async () => {
    localStorage.setItem('hatstand.notes-panel', 'open');
    const first = renderTask();
    await screen.findByLabelText('Task note');
    await userEvent.click(screen.getByRole('button', { name: 'Hide agent work' }));
    expect(screen.queryByLabelText('Task note')).toBeNull();
    expect(screen.getByTestId('terminal').dataset['focus']).toBe('1');
    first.unmount();
    renderTask();
    screen.getByRole('button', { name: 'Show agent work' });
  });

  it('shows the terminal when a session starts while the task is open, such as right after it was created', async () => {
    const idle = { ...snapshot, sessions: [] } as unknown as Snapshot;
    const view = render(<TaskPanel snapshot={idle} task={task} onChanged={vi.fn(async () => {})} onOpenClient={vi.fn()} onSentBack={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    view.rerender(<TaskPanel snapshot={snapshot} task={task} onChanged={vi.fn(async () => {})} onOpenClient={vi.fn()} onSentBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('tab', { name: /Terminal/ }).getAttribute('aria-selected')).toBe('true'));
    await userEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    view.rerender(<TaskPanel snapshot={{ ...snapshot, sessions: [{ ...session(), state: 'working' }] } as unknown as Snapshot} task={task} onChanged={vi.fn(async () => {})} onOpenClient={vi.fn()} onSentBack={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
  });

  it('starts hidden in a narrow window, and opens when asked', async () => {
    renderTask();
    expect(window.innerWidth).toBeLessThan(1100);
    await userEvent.click(screen.getByRole('button', { name: 'Show agent work' }));
    await screen.findByLabelText('Task note');
    await waitFor(() => expect(localStorage.getItem('hatstand.notes-panel')).toBe('open'));
  });
});

describe('what the agent did, beside the terminal', () => {
  const changes = [
    {
      projectId: 'api',
      name: 'api',
      path: '/copies/api',
      isRepo: true,
      branch: 'hatstand/fix-login',
      changes: [{ path: 'src/login.ts', status: 'modified' }, { path: 'src/new.ts', status: 'untracked' }],
      before: [{ path: 'README.md', status: 'modified' }],
      committed: [{ path: 'src/login.ts', status: 'modified' }, { path: 'old.ts', status: 'deleted' }],
      commits: 2,
      truncated: false,
    },
    { projectId: 'web', name: 'web', path: '/code/web', isRepo: true, branch: 'main', changes: [], before: [], committed: [], commits: 0, truncated: false },
  ];

  const copy = { ...task, projectIds: ['api'], isolated: true, worktrees: [{ projectId: 'api', path: '/copies/api', branch: 'hatstand/fix-login', base: 'main' }] };
  const document = { name: 'plan.md', path: '/data/tasks/t.plan.md', updatedAt: '2026-01-01' };
  const answer = (found: unknown[]) => async (method: string) =>
    method === 'taskChanges' ? found : method === 'listTaskOutputs' ? [document] : method === 'detectEditor' ? 'Cursor' : method === 'readTaskNote' ? '' : undefined;
  const opened = () => invoke.mock.calls.filter(([method]) => method === 'openInEditor').map(([, companyId, path]) => [companyId, path]);

  it('lists the repositories with a button that opens the copy of the task in the editor', async () => {
    invoke.mockImplementation(answer(changes));
    renderPanel('idle', SUMMARY, copy);
    const repos = within(screen.getByRole('region', { name: 'Repositories' }));
    expect(repos.getByText('api')).toBeTruthy();
    expect(repos.getByText('hatstand/fix-login')).toBeTruthy();
    await userEvent.click(await repos.findByRole('button', { name: 'Open the copy of api in Cursor' }));
    expect(opened()).toEqual([['acme', '/copies/api']]);
  });

  it('lists the changed files by repository as links to the editor, without files changed before it started', async () => {
    invoke.mockImplementation(answer(changes));
    renderPanel('idle', SUMMARY, copy);
    const files = within(screen.getByRole('region', { name: 'Files changed' }));
    const api = within(await files.findByRole('group', { name: 'Changed in api' }));
    expect(api.getByText('2 commits')).toBeTruthy();
    expect(api.getByText('old.ts')).toBeTruthy();
    expect(files.queryByText('README.md')).toBeNull();
    expect(files.queryByText('src/new.ts')).toBeNull();
    expect(files.queryByRole('group', { name: 'Changed in web' })).toBeNull();
    await userEvent.click(api.getByRole('button', { name: 'src/login.ts' }));
    expect(opened()).toEqual([['acme', '/copies/api/src/login.ts']]);
  });

  it('lists the files it created and its documents as links to the editor', async () => {
    invoke.mockImplementation(answer(changes));
    renderPanel('idle', SUMMARY, copy);
    const created = within(screen.getByRole('region', { name: 'Files created' }));
    await userEvent.click(await created.findByRole('button', { name: 'src/new.ts' }));
    await userEvent.click(created.getByRole('button', { name: 'plan.md' }));
    expect(opened()).toEqual([['acme', '/copies/api/src/new.ts'], ['acme', '/data/tasks/t.plan.md']]);
    expect(created.queryByText('src/login.ts')).toBeNull();
  });

  it('says so before the agent changed anything', async () => {
    invoke.mockImplementation(async (method: string) => (method === 'taskChanges' || method === 'listTaskOutputs' ? [] : method === 'readTaskNote' ? '' : undefined));
    renderPanel();
    await screen.findByLabelText('Task note');
    expect(screen.getByText('The agent has not changed any file yet.')).toBeTruthy();
    expect(screen.getByText('The agent has not created any file yet.')).toBeTruthy();
    expect(screen.getByText('No repository is selected for this task.')).toBeTruthy();
  });

  it('shows a new file while the session runs, without the person refreshing', async () => {
    let found: unknown[] = [];
    invoke.mockImplementation(async (method: string) => (method === 'taskChanges' ? found : method === 'listTaskOutputs' ? [] : method === 'readTaskNote' ? '' : undefined));
    vi.useFakeTimers();
    renderPanel('working', SUMMARY, copy);
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(screen.queryByRole('button', { name: 'src/new.ts' })).toBeNull();
    found = changes;
    await act(() => vi.advanceTimersByTimeAsync(FILES_REFRESH_MS + 10));
    expect(screen.getByRole('button', { name: 'src/new.ts' })).toBeTruthy();
  });

  it('stops reading the files once the session stopped', async () => {
    invoke.mockImplementation(answer([]));
    vi.useFakeTimers();
    renderPanel('stopped', SUMMARY, copy);
    await act(() => vi.advanceTimersByTimeAsync(FILES_REFRESH_MS * 3));
    expect(invoke.mock.calls.filter(([method]) => method === 'taskChanges')).toHaveLength(1);
  });

  it('opens the notes of the task and the files written outside git from the files created', async () => {
    const outside = { folders: [{ folder: '/data/knowledge', changes: [{ path: '/data/knowledge/report.md', status: 'added' }, { path: '/data/knowledge/old.md', status: 'deleted' }] }], truncated: false };
    invoke.mockImplementation(async (method: string) => (method === 'taskOutsideChanges' ? outside : answer(changes)(method)));
    renderPanel('idle', SUMMARY, copy);
    const created = within(screen.getByRole('region', { name: 'Files created' }));
    await userEvent.click(created.getByRole('button', { name: 'Task notes' }));
    expect(invoke).toHaveBeenCalledWith('openTaskNotesInEditor', 't');
    const folder = within(await created.findByRole('group', { name: 'Written in /data/knowledge' }));
    expect(folder.queryByText('old.md')).toBeNull();
    await userEvent.click(folder.getByRole('button', { name: 'report.md' }));
    expect(invoke).toHaveBeenCalledWith('openTaskChangedFile', 't', '/data/knowledge/report.md');
  });

  it('offers no notes to open before the agent wrote any', async () => {
    renderPanel('idle', '');
    await screen.findByLabelText('Task note');
    expect(screen.queryByRole('button', { name: 'Task notes' })).toBeNull();
  });

  it('opens each repository with an icon that keeps its name, and its page on GitHub when it has one', async () => {
    invoke.mockImplementation(async (method: string) => (method === 'repositoryLinks' ? { api: 'https://github.com/acme/api' } : answer(changes)(method)));
    renderPanel('idle', SUMMARY, { ...copy, projectIds: ['api'] });
    const repos = within(screen.getByRole('region', { name: 'Repositories' }));
    const editor = await repos.findByRole('button', { name: 'Open the copy of api in Cursor' });
    expect(editor.textContent).toBe('');
    await userEvent.click(await repos.findByRole('button', { name: 'Open api on GitHub' }));
    expect(invoke).toHaveBeenCalledWith('openLink', 'https://github.com/acme/api');
  });

  it('shows no site icon for a repository without a page', async () => {
    invoke.mockImplementation(answer(changes));
    renderPanel('idle', SUMMARY, copy);
    const repos = within(screen.getByRole('region', { name: 'Repositories' }));
    await repos.findByRole('button', { name: 'Open the copy of api in Cursor' });
    expect(repos.queryByRole('button', { name: /Open api on/ })).toBeNull();
  });

  it.each(['TL;DR', 'Repositories', 'Files changed', 'Files created', 'Your note'])('folds away %s, and keeps it folded for the next task', async (title) => {
    const first = renderPanel();
    await screen.findByLabelText('Task note');
    const section = () => screen.getByRole('region', { name: title });
    const body = section().querySelector('.panel-section-body');
    expect(body).not.toBeNull();
    await userEvent.click(within(section()).getByRole('button', { name: title }));
    expect(section().querySelector('.panel-section-body')).toBeNull();
    expect(within(section()).getByRole('button', { name: title }).getAttribute('aria-expanded')).toBe('false');
    first.unmount();
    renderPanel('idle', SUMMARY, { ...task, id: 'other' });
    expect(section().querySelector('.panel-section-body')).toBeNull();
    await userEvent.click(within(section()).getByRole('button', { name: title }));
    expect(section().querySelector('.panel-section-body')).not.toBeNull();
  });

  it('opens a file named in the TL;DR in the editor, and leaves a web link to the browser', async () => {
    const notes = '## TL;DR\n- Plan in [plan.md](/data/tasks/t.plan.md).\n- See `/code/api/src/login.ts:12` and [the ticket](https://example.com/t/1).\n- Run `pnpm test`.\n';
    invoke.mockImplementation(answer([]));
    renderPanel('idle', notes);
    const summary = within(screen.getByRole('region', { name: 'TL;DR' }));
    await userEvent.click(summary.getByRole('button', { name: 'plan.md' }));
    await userEvent.click(summary.getByRole('button', { name: '/code/api/src/login.ts:12' }));
    expect(opened()).toEqual([['acme', '/data/tasks/t.plan.md'], ['acme', '/code/api/src/login.ts']]);
    expect(summary.getByRole('link', { name: 'the ticket' }).getAttribute('href')).toBe('https://example.com/t/1');
    expect(summary.queryByRole('button', { name: 'pnpm test' })).toBeNull();
  });

  it('folds away your note', async () => {
    renderPanel();
    await screen.findByLabelText('Task note');
    await userEvent.click(screen.getByRole('button', { name: 'Your note' }));
    expect(screen.queryByLabelText('Task note')).toBeNull();
  });
});
