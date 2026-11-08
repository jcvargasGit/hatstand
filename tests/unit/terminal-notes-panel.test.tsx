// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bridge, Snapshot } from '../../src/shared/api';
import type { Company, Session, SessionState, Task } from '../../src/shared/schemas';
import { TaskPanel } from '../../src/renderer/src/components/TaskPanel';
import { TerminalNotesPanel } from '../../src/renderer/src/components/TerminalNotesPanel';

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

const renderPanel = (state: SessionState = 'idle', notes = SUMMARY) => render(<TerminalNotesPanel taskId="t" session={session(state)} notes={notes} onLeave={vi.fn()} />);
const updateButton = () => screen.getByRole<HTMLButtonElement>('button', { name: /Update/ });

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (method: string) => {
    if (method === 'readTaskNote') return 'saved note';
    if (method === 'readNotes') return SUMMARY;
    if (method === 'listPlaybooks') return { playbooks: [], problems: [] };
    if (method === 'readSubagents') return [];
    return undefined;
  });
  window.hatstand = { invoke, on: () => () => {} } as unknown as Bridge;
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the note beside the terminal', () => {
  it('opens with the saved text', async () => {
    renderPanel();
    expect((await screen.findByLabelText<HTMLTextAreaElement>('Task note')).value).toBe('saved note');
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
    invoke.mockImplementation(async () => {
      throw new Error('Could not read the task.');
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
    render(<TerminalNotesPanel taskId="t" session={{ ...session(), draft: true }} notes={SUMMARY} onLeave={vi.fn()} />);
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
    view.rerender(<TerminalNotesPanel taskId="t" session={session()} notes="## TL;DR\nNew." onLeave={vi.fn()} />);
    await screen.findByRole('button', { name: 'Update' });
  });

  it('stops showing it is updating when the turn ends with the same notes', async () => {
    const view = renderPanel();
    await screen.findByLabelText('Task note');
    await userEvent.click(updateButton());
    await screen.findByRole('button', { name: 'Updating…' });
    view.rerender(<TerminalNotesPanel taskId="t" session={session('working')} notes={SUMMARY} onLeave={vi.fn()} />);
    view.rerender(<TerminalNotesPanel taskId="t" session={session('idle')} notes={SUMMARY} onLeave={vi.fn()} />);
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
  const snapshot = { companies: [company], accounts: { defaultAccountId: 'c', accounts: [{ id: 'c', name: 'Claude', type: 'claude-code', label: 'personal' }] }, tasks: [task], sessions: [session()], reviews: {} } as unknown as Snapshot;
  const renderTask = () => render(<TaskPanel snapshot={snapshot} task={task} onChanged={vi.fn(async () => {})} onOpenClient={vi.fn()} />);

  it('hides it, gives the keyboard back to the terminal and remembers the choice', async () => {
    localStorage.setItem('hatstand.notes-panel', 'open');
    const first = renderTask();
    await screen.findByLabelText('Task note');
    await userEvent.click(screen.getByRole('button', { name: 'Hide note' }));
    expect(screen.queryByLabelText('Task note')).toBeNull();
    expect(screen.getByTestId('terminal').dataset['focus']).toBe('1');
    first.unmount();
    renderTask();
    screen.getByRole('button', { name: 'Show note' });
  });

  it('starts hidden in a narrow window, and opens when asked', async () => {
    renderTask();
    expect(window.innerWidth).toBeLessThan(1100);
    await userEvent.click(screen.getByRole('button', { name: 'Show note' }));
    await screen.findByLabelText('Task note');
    await waitFor(() => expect(localStorage.getItem('hatstand.notes-panel')).toBe('open'));
  });
});
