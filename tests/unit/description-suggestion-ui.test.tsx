// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdeaDetails } from '../../src/renderer/src/components/IdeaDetails';
import { NewTaskPage } from '../../src/renderer/src/components/NewTaskPage';
import type { Bridge, Snapshot } from '../../src/shared/api';
import type { SuggestionRequest } from '../../src/shared/description-suggestion';
import { companySchema, taskSchema } from '../../src/shared/schemas';

const calls = vi.hoisted(() => ({
  suggest: vi.fn(async (_request: unknown) => ({ description: 'A fuller description' })),
  cancel: vi.fn(async (_key: string) => undefined),
  updateTask: vi.fn(async (_id: string, _patch: unknown) => undefined),
  createTask: vi.fn(async (_input: unknown) => ({ id: 't' })),
}));

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: {
    suggestDescription: (request: unknown) => calls.suggest(request),
    cancelDescriptionSuggestion: (key: string) => calls.cancel(key),
    updateTask: (id: string, patch: unknown) => calls.updateTask(id, patch),
    createTask: (input: unknown) => calls.createTask(input),
    listPlaybooks: async () => ({ playbooks: [], problems: [] }),
  },
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));
vi.mock('../../src/renderer/src/components/MarkdownField', () => ({
  MarkdownField: ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => (
    <textarea aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.hatstand = { invoke: vi.fn(), on: () => () => {} } as unknown as Bridge;
});
afterEach(cleanup);

const task = taskSchema.parse({ id: 'one', companyId: 'c', title: 'Fix the login', description: 'Staging only', status: 'idea', projectIds: ['api'], createdAt: 'x', updatedAt: 'x' });
const renderDetails = () => render(<IdeaDetails task={task} onClose={() => {}} onChanged={async () => undefined} onMadeTask={() => {}} />);
const dialog = () => screen.findByRole('dialog', { name: 'Suggested description' });

describe('improving the description of an inbox item', () => {
  it('asks for a suggestion with the item and its repositories', async () => {
    renderDetails();
    await userEvent.click(screen.getByRole('button', { name: 'Improve description' }));
    await within(await dialog()).findByText('A fuller description');
    expect(calls.suggest).toHaveBeenCalledWith(expect.objectContaining({ key: 'one', companyId: 'c', title: 'Fix the login', description: 'Staging only', projectIds: ['api'] }));
  });

  it('replaces only the description when accepted', async () => {
    renderDetails();
    await userEvent.click(screen.getByRole('button', { name: 'Improve description' }));
    await userEvent.click(await within(await dialog()).findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(calls.updateTask).toHaveBeenCalledWith('one', { description: 'A fuller description' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByLabelText('Details') as HTMLTextAreaElement).value).toBe('A fuller description');
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Fix the login');
  });

  it('changes nothing when discarded or closed with Escape', async () => {
    renderDetails();
    await userEvent.click(screen.getByRole('button', { name: 'Improve description' }));
    await userEvent.click(await within(await dialog()).findByRole('button', { name: 'Discard' }));
    await userEvent.click(screen.getByRole('button', { name: 'Improve description' }));
    await within(await dialog()).findByText('A fuller description');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.updateTask).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Details') as HTMLTextAreaElement).value).toBe('Staging only');
  });

  it('cancels a suggestion that is still running', async () => {
    calls.suggest.mockImplementationOnce(() => new Promise(() => {}));
    renderDetails();
    await userEvent.click(screen.getByRole('button', { name: 'Improve description' }));
    await within(await dialog()).findByRole('status');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls.cancel).toHaveBeenCalledWith('one');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows why a suggestion failed, and can try again', async () => {
    calls.suggest.mockRejectedValueOnce(new Error('The agent took more than 5 minutes.'));
    renderDetails();
    await userEvent.click(screen.getByRole('button', { name: 'Improve description' }));
    await within(await dialog()).findByText('The agent took more than 5 minutes.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await within(await dialog()).findByText('A fuller description');
    expect(calls.suggest).toHaveBeenCalledTimes(2);
  });

  it('warns only when the description changed while the suggestion was written', async () => {
    let finish: (value: { description: string }) => void = () => {};
    calls.suggest.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    renderDetails();
    await userEvent.click(screen.getByRole('button', { name: 'Improve description' }));
    await within(await dialog()).findByRole('status');
    await userEvent.type(screen.getByLabelText('Details'), ' and prod');
    finish({ description: 'Better' });
    await within(await dialog()).findByText('Better');
    expect(screen.getByRole('note').textContent).toContain('The description changed after you asked');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(calls.suggest).toHaveBeenLastCalledWith(expect.objectContaining({ description: 'Staging only and prod' }));
    await within(await dialog()).findByText('A fuller description');
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('improving the description of a new task', () => {
  const company = companySchema.parse({ id: 'c', name: 'Client', color: '#5BB8A6', projects: [{ id: 'api', name: 'api', path: '/a' }] });
  const snapshot = { companies: [company], tasks: [], sessions: [], accounts: { accounts: [] }, reviews: {}, guideNewTasks: false } as unknown as Snapshot;

  it('needs a title or a description first', () => {
    render(<NewTaskPage snapshot={snapshot} initialCompanyId="c" onCreated={async () => undefined} onChanged={async () => undefined} />);
    expect(screen.getByRole('button', { name: 'Improve description' })).toHaveProperty('disabled', true);
  });

  it('fills the description field without creating the task', async () => {
    render(<NewTaskPage snapshot={snapshot} initialCompanyId="c" onCreated={async () => undefined} onChanged={async () => undefined} />);
    await userEvent.type(screen.getByLabelText('Task title'), 'Add export');
    await userEvent.click(screen.getByRole('button', { name: 'Improve description' }));
    await userEvent.click(await within(await dialog()).findByRole('button', { name: 'Accept' }));
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('A fuller description');
    expect(calls.createTask).not.toHaveBeenCalled();
    expect(calls.updateTask).not.toHaveBeenCalled();
    const request = calls.suggest.mock.calls[0]?.[0] as SuggestionRequest;
    expect(request).toMatchObject({ companyId: 'c', title: 'Add export', projectIds: ['api'] });
    expect(request.key).toMatch(/^new-task-/);
  });
});
