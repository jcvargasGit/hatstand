// @vitest-environment jsdom
// The New task form in the side panel and in a window of its own, and the setting that sends the first prompt.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoSendSection } from '../../src/renderer/src/components/AutoSendSection';
import { NewTaskPage } from '../../src/renderer/src/components/NewTaskPage';
import { NewTaskWindow } from '../../src/renderer/src/components/NewTaskWindow';
import { draftFromIdea, fitDraft, startDraft } from '../../src/renderer/src/lib/new-task-draft';
import type { Bridge, Snapshot } from '../../src/shared/api';
import type { NewTaskDraft } from '../../src/shared/new-task-draft';
import { companySchema, taskSchema } from '../../src/shared/schemas';

vi.mock('../../src/renderer/src/components/MarkdownField', () => ({
  MarkdownField: ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => <textarea aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />,
}));

const invoke = vi.fn();
const company = companySchema.parse({
  id: 'acme',
  name: 'Acme',
  color: '#5BB8A6',
  rootDir: '/code',
  subdomains: [{ id: 'pay', name: 'Payments' }],
  projects: [{ id: 'api', name: 'api', path: '/code/api' }, { id: 'web', name: 'web', path: '/code/web' }],
});
const snapshotOf = (change: Partial<Snapshot> = {}) =>
  ({
    companies: [company],
    tasks: [],
    sessions: [],
    reviews: {},
    accounts: { defaultAccountId: 'claude', accounts: [{ id: 'claude', name: 'Claude', type: 'claude-code', label: 'personal' }] },
    guideNewTasks: false,
    guideUsage: {},
    autoSendPrompt: true,
    ...change,
  }) as unknown as Snapshot;
const snapshot = snapshotOf();
const idea = taskSchema.parse({ id: 'idea-1', companyId: 'acme', title: 'Export invoices', description: 'As a CSV file.', status: 'idea', projectIds: ['web'], subdomainId: 'pay', priority: 'medium', createdAt: 'x', updatedAt: 'x' });
const written: NewTaskDraft = { ...startDraft(snapshot, 'acme'), title: 'Half a title', description: 'Half a sentence', playbookId: 'bug', guideChosen: true, areaId: 'pay', areaChosen: true, projectIds: ['api', 'web'], priority: 'high', isolated: false };

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (method: string, ...args: unknown[]) => {
    if (method === 'listPlaybooks') return { playbooks: [{ id: 'bug', name: 'Investigate a bug', steps: [{ name: 'a', prompt: 'b' }], origin: 'built-in' }], problems: [] };
    if (method === 'getSnapshot') return snapshot;
    if (method === 'createTask') return { id: 'new' };
    if (method === 'makeTask') return { id: args[0] };
    if (method === 'readNewTaskDraft') return written;
    return undefined;
  });
  window.hatstand = { invoke, on: () => () => {} } as unknown as Bridge;
});
afterEach(cleanup);

const renderPage = (draft: NewTaskDraft, props: Partial<Parameters<typeof NewTaskPage>[0]> = {}, data = snapshot) => {
  const onCreated = vi.fn(async () => {});
  render(<NewTaskPage snapshot={data} initialDraft={draft} onCreated={onCreated} onChanged={vi.fn(async () => {})} {...props} />);
  return { onCreated };
};

describe('making a backlog item a task', () => {
  it('fills the form with what the item already has', () => {
    expect(draftFromIdea(idea, snapshot)).toMatchObject({ ideaId: 'idea-1', title: 'Export invoices', description: 'As a CSV file.', companyId: 'acme', areaId: 'pay', areaChosen: true, projectIds: ['web'], priority: 'medium' });
    renderPage(draftFromIdea(idea, snapshot));
    expect(screen.getByRole('region', { name: 'Backlog item to task' })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Task title').value).toBe('Export invoices');
    expect(screen.getByLabelText<HTMLTextAreaElement>('Description').value).toBe('As a CSV file.');
    expect(screen.queryByRole('combobox', { name: 'Client' })).toBeNull();
  });

  it('saves the same task, with the changes made in the form, and creates no other', async () => {
    const { onCreated } = renderPage(draftFromIdea(idea, snapshot));
    await userEvent.type(screen.getByLabelText('Task title'), ' today');
    await userEvent.click(screen.getByRole('button', { name: 'Make it a task' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('idea-1', 'acme'));
    expect(invoke).toHaveBeenCalledWith('makeTask', 'idea-1', expect.objectContaining({ title: 'Export invoices today', description: 'As a CSV file.', subdomainId: 'pay', projectIds: ['web'], priority: 'medium' }));
    expect(invoke).not.toHaveBeenCalledWith('createTask', expect.anything());
    expect(invoke).not.toHaveBeenCalledWith('startSession', expect.anything());
  });

  it('can start the session of that same task', async () => {
    renderPage(draftFromIdea(idea, snapshot));
    await userEvent.click(screen.getByRole('button', { name: 'Make it a task and start session' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('startSession', 'idea-1'));
  });
});

describe('moving the form to a window of its own', () => {
  it('hands over everything written and chosen so far', async () => {
    const onMoveToWindow = vi.fn(async () => {});
    renderPage(startDraft(snapshot, 'acme'), { onMoveToWindow });
    await userEvent.type(screen.getByLabelText('Task title'), 'Half a title');
    await userEvent.type(screen.getByLabelText('Description'), 'Half a sentence');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Priority' }), 'high');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^Code/ }), 'shared');
    await userEvent.click(screen.getByRole('button', { name: 'Open in new window' }));
    expect(onMoveToWindow).toHaveBeenCalledWith(expect.objectContaining({ title: 'Half a title', description: 'Half a sentence', priority: 'high', isolated: false, companyId: 'acme' }));
    expect(invoke).not.toHaveBeenCalledWith('createTask', expect.anything());
  });

  it('offers no such button in the window itself', () => {
    renderPage(startDraft(snapshot, 'acme'));
    expect(screen.queryByRole('button', { name: 'Open in new window' })).toBeNull();
  });

  it('opens the window with the draft the main process kept, and keeps every later change there', async () => {
    render(<NewTaskWindow draftId="d1" />);
    const title = await screen.findByLabelText<HTMLInputElement>('Task title');
    expect(invoke).toHaveBeenCalledWith('readNewTaskDraft', 'd1');
    expect(title.value).toBe('Half a title');
    expect(screen.getByLabelText<HTMLTextAreaElement>('Description').value).toBe('Half a sentence');
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Priority' }).value).toBe('high');
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: /^Code/ }).value).toBe('shared');
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: /^Area/ }).value).toBe('pay');
    await userEvent.type(title, '!');
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('saveNewTaskDraft', 'd1', expect.objectContaining({ title: 'Half a title!', description: 'Half a sentence', projectIds: ['api', 'web'] })));
  });

  it('tells the main window which task was created there', async () => {
    render(<NewTaskWindow draftId="d1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('finishNewTaskWindow', 'd1', 'new'));
    expect(invoke).toHaveBeenCalledWith('createTask', expect.objectContaining({ title: 'Half a title', description: 'Half a sentence', playbookId: 'bug', subdomainId: 'pay', projectIds: ['api', 'web'], priority: 'high', isolated: false }));
  });

  it('says so when the draft is gone, such as after the task was created', async () => {
    invoke.mockImplementation(async (method: string) => (method === 'getSnapshot' ? snapshot : method === 'readNewTaskDraft' ? null : undefined));
    render(<NewTaskWindow draftId="gone" />);
    expect(await screen.findByText(/already created or closed/)).toBeTruthy();
  });

  it('keeps what was written when the client of the draft no longer exists', () => {
    const fitted = fitDraft({ ...written, companyId: 'gone' }, snapshot);
    expect(fitted).toMatchObject({ title: 'Half a title', description: 'Half a sentence', companyId: 'acme' });
    expect(fitDraft({ ...written, projectIds: ['api', 'removed'], areaId: 'removed' }, snapshot)).toMatchObject({ projectIds: ['api'], areaId: '', areaChosen: false });
  });
});

describe('sending the first prompt by itself', () => {
  it('says the agent starts at once, without the hint to press Enter', () => {
    renderPage(startDraft(snapshot, 'acme'));
    expect(screen.getByText(/starts working on the task as soon as the session opens/)).toBeTruthy();
    expect(screen.queryByText(/Press Enter to send it/)).toBeNull();
  });

  it('says the prompt waits for Enter when the setting is off', () => {
    const off = snapshotOf({ autoSendPrompt: false });
    renderPage(startDraft(off, 'acme'), {}, off);
    expect(screen.getByText(/Press Enter to send it, or change it first\./)).toBeTruthy();
    expect(screen.queryByText(/starts working on the task as soon as/)).toBeNull();
  });

  it('is turned off and on in Settings', async () => {
    const onChanged = vi.fn(async () => {});
    const { rerender } = render(<AutoSendSection enabled onChanged={onChanged} />);
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Send the first prompt of a task without waiting for Enter' });
    expect(box.checked).toBe(true);
    await userEvent.click(box);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledWith('setAutoSendPrompt', false);
    rerender(<AutoSendSection enabled={false} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(invoke).toHaveBeenCalledWith('setAutoSendPrompt', true);
  });
});
