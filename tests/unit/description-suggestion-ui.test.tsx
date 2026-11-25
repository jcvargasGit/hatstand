// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdeaDetails } from '../../src/renderer/src/components/IdeaDetails';
import { IdeaRow } from '../../src/renderer/src/components/IdeaRow';
import { NewTaskPage } from '../../src/renderer/src/components/NewTaskPage';
import { startDraft } from '../../src/renderer/src/lib/new-task-draft';
import { suggestions } from '../../src/renderer/src/lib/suggestion-store';
import type { Bridge, Snapshot } from '../../src/shared/api';
import type { SuggestionRequest } from '../../src/shared/description-suggestion';
import { companySchema, taskSchema } from '../../src/shared/schemas';

const calls = vi.hoisted(() => ({
  suggest: vi.fn(async (_request: unknown) => ({ description: 'A fuller description' })),
  instructions: vi.fn(async (_companyId: string, _subdomainId?: string) => 'Keep every fact.'),
  cancel: vi.fn(async (_key: string) => undefined),
  updateTask: vi.fn(async (_id: string, _patch: unknown) => undefined),
  createTask: vi.fn(async (_input: unknown) => ({ id: 't' })),
}));

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: {
    suggestDescription: (request: unknown) => calls.suggest(request),
    cancelDescriptionSuggestion: (key: string) => calls.cancel(key),
    descriptionInstructions: (companyId: string, subdomainId?: string) => calls.instructions(companyId, subdomainId),
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
vi.mock('../../src/renderer/src/components/MarkdownEditor', () => ({
  MarkdownEditor: ({ label, initialValue, onChange }: { label: string; initialValue: string; onChange: (value: string) => void }) => (
    <textarea aria-label={label} defaultValue={initialValue} autoFocus onChange={(event) => onChange(event.target.value)} />
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  suggestions.reset();
  window.hatstand = { invoke: vi.fn(), on: () => () => {} } as unknown as Bridge;
});
afterEach(cleanup);

const task = taskSchema.parse({ id: 'one', companyId: 'c', title: 'Fix the login', description: 'Staging only', status: 'idea', projectIds: ['api'], createdAt: 'x', updatedAt: 'x' });
const renderDetails = () => render(<IdeaDetails task={task} onClose={() => {}} onChanged={async () => undefined} onMakeTask={() => {}} />);
const dialog = () => screen.findByRole('dialog', { name: 'Suggested description' });
const promptDialog = () => screen.findByRole('dialog', { name: 'Improve description' });
const openPrompt = async (name = 'Improve description') => {
  await userEvent.click(screen.getByRole('button', { name }));
  return within(await promptDialog());
};
const send = async () => userEvent.click(await within(await promptDialog()).findByRole('button', { name: 'Send' }));
const ask = async (name?: string) => {
  await openPrompt(name);
  await send();
};
const promptField = async () => within(await promptDialog()).findByLabelText<HTMLTextAreaElement>('Prompt');

describe('writing the prompt before the assistant runs', () => {
  it('opens the prompt of the area of the task, and does not run the assistant yet', async () => {
    render(<IdeaDetails task={{ ...task, subdomainId: 'billing' }} onClose={() => {}} onChanged={async () => undefined} onMakeTask={() => {}} />);
    await openPrompt();
    expect((await promptField()).value).toBe('Keep every fact.');
    expect(calls.instructions).toHaveBeenCalledWith('c', 'billing');
    expect(calls.suggest).not.toHaveBeenCalled();
  });

  it('sends the prompt as the person left it', async () => {
    renderDetails();
    await openPrompt();
    await userEvent.type(await promptField(), ' Name the files.');
    await send();
    await within(await dialog()).findByText('A fuller description');
    expect(calls.suggest).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: 'one', instructions: 'Keep every fact. Name the files.' }));
  });

  it('can send an empty prompt', async () => {
    renderDetails();
    await openPrompt();
    await userEvent.clear(await promptField());
    await send();
    await within(await dialog()).findByText('A fuller description');
    expect(calls.suggest).toHaveBeenCalledWith(expect.objectContaining({ instructions: '' }));
  });

  it('brings the default back with "Reset to default"', async () => {
    renderDetails();
    const prompt = await openPrompt();
    const reset = prompt.getByRole('button', { name: 'Reset to default' });
    expect(reset).toHaveProperty('disabled', true);
    await userEvent.type(await promptField(), ' Extra.');
    await userEvent.click(reset);
    expect((await promptField()).value).toBe('Keep every fact.');
  });

  it('runs nothing when the prompt is cancelled or closed with Escape', async () => {
    renderDetails();
    const prompt = await openPrompt();
    await userEvent.click(prompt.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await openPrompt();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.suggest).not.toHaveBeenCalled();
    expect(calls.cancel).not.toHaveBeenCalled();
  });

  it('returns to the prompt with the last text on "Try again"', async () => {
    renderDetails();
    await openPrompt();
    await userEvent.type(await promptField(), ' Name the files.');
    await send();
    await userEvent.click(await within(await dialog()).findByRole('button', { name: 'Try again' }));
    expect((await promptField()).value).toBe('Keep every fact. Name the files.');
    expect(calls.suggest).toHaveBeenCalledTimes(1);
    expect(calls.instructions).toHaveBeenCalledTimes(1);
  });

  it('says when the prompt could not be read, and can try again', async () => {
    calls.instructions.mockRejectedValueOnce(new Error('This client is gone.'));
    renderDetails();
    await userEvent.click(screen.getByRole('button', { name: 'Improve description' }));
    await within(await dialog()).findByText('This client is gone.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect((await promptField()).value).toBe('Keep every fact.');
  });
});

describe('improving the description of a backlog item', () => {
  it('asks for a suggestion with the item and its repositories', async () => {
    renderDetails();
    await ask();
    await within(await dialog()).findByText('A fuller description');
    expect(calls.suggest).toHaveBeenCalledWith(expect.objectContaining({ key: 'one', companyId: 'c', title: 'Fix the login', description: 'Staging only', projectIds: ['api'] }));
  });

  it('replaces only the description when accepted', async () => {
    renderDetails();
    await ask();
    await userEvent.click(await within(await dialog()).findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(calls.updateTask).toHaveBeenCalledWith('one', { description: 'A fuller description' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByLabelText('Details') as HTMLTextAreaElement).value).toBe('A fuller description');
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Fix the login');
  });

  it('changes nothing when discarded or closed with Escape', async () => {
    renderDetails();
    await ask();
    await userEvent.click(await within(await dialog()).findByRole('button', { name: 'Discard' }));
    await ask();
    await within(await dialog()).findByText('A fuller description');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.updateTask).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Details') as HTMLTextAreaElement).value).toBe('Staging only');
  });

  it('cancels a suggestion that is still running', async () => {
    calls.suggest.mockImplementationOnce(() => new Promise(() => {}));
    renderDetails();
    await ask();
    await within(await dialog()).findByRole('status');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls.cancel).toHaveBeenCalledWith('one');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows why a suggestion failed, and can try again', async () => {
    calls.suggest.mockRejectedValueOnce(new Error('The agent took more than 5 minutes.'));
    renderDetails();
    await ask();
    await within(await dialog()).findByText('The agent took more than 5 minutes.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await send();
    await within(await dialog()).findByText('A fuller description');
    expect(calls.suggest).toHaveBeenCalledTimes(2);
  });

  it('warns only when the description changed while the suggestion was written', async () => {
    let finish: (value: { description: string }) => void = () => {};
    calls.suggest.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    renderDetails();
    await ask();
    await within(await dialog()).findByRole('status');
    await userEvent.type(screen.getByLabelText('Details'), ' and prod');
    finish({ description: 'Better' });
    await within(await dialog()).findByText('Better');
    expect(screen.getByRole('note').textContent).toContain('The description changed after you asked');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await send();
    expect(calls.suggest).toHaveBeenLastCalledWith(expect.objectContaining({ description: 'Staging only and prod' }));
    await within(await dialog()).findByText('A fuller description');
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('a suggestion that continues in the background', () => {
  const pending = () => {
    let finish: (value: { description: string }) => void = () => {};
    calls.suggest.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    return (description: string) => finish({ description });
  };
  const backdrop = () => document.querySelector<HTMLElement>('.suggestion-backdrop') as HTMLElement;

  it('keeps running when the person clicks outside the dialog, and the button shows it', async () => {
    pending();
    renderDetails();
    await ask();
    await within(await dialog()).findByRole('status');
    await userEvent.click(backdrop());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.cancel).not.toHaveBeenCalled();
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Writing suggestion' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.disabled).toBe(false);
  });

  it.each(['Close', 'Continue in the background'])('keeps running when closed with "%s", and with Escape', async (name) => {
    pending();
    renderDetails();
    await ask();
    await userEvent.click(await within(await dialog()).findByRole('button', { name }));
    await userEvent.click(screen.getByRole('button', { name: 'Writing suggestion' }));
    await within(await dialog()).findByRole('status');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.cancel).not.toHaveBeenCalled();
  });

  it('shows the dialog again while it is still writing, and stops only with Cancel', async () => {
    pending();
    renderDetails();
    await ask();
    await userEvent.click(backdrop());
    await userEvent.click(screen.getByRole('button', { name: 'Writing suggestion' }));
    await userEvent.click(await within(await dialog()).findByRole('button', { name: 'Cancel' }));
    expect(calls.cancel).toHaveBeenCalledExactlyOnceWith('one');
    expect(screen.getByRole('button', { name: 'Improve description' })).toBeTruthy();
  });

  it('waits behind the button when it finishes while hidden, and opens on the text to accept', async () => {
    const finish = pending();
    renderDetails();
    await ask();
    await userEvent.click(backdrop());
    finish('Written meanwhile');
    await userEvent.click(await screen.findByRole('button', { name: 'See suggestion' }));
    await userEvent.click(await within(await dialog()).findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(calls.updateTask).toHaveBeenCalledWith('one', { description: 'Written meanwhile' }));
    expect(screen.getByRole('button', { name: 'Improve description' })).toBeTruthy();
  });

  it('opens by itself on the suggestion when the dialog stayed open', async () => {
    const finish = pending();
    renderDetails();
    await ask();
    finish('Written while watching');
    await within(await dialog()).findByText('Written while watching');
  });

  it('survives leaving the page: coming back shows it is still writing, then the suggestion', async () => {
    const finish = pending();
    const first = renderDetails();
    await ask();
    await userEvent.click(backdrop());
    first.unmount();
    expect(calls.cancel).not.toHaveBeenCalled();
    renderDetails();
    expect(screen.getByRole('button', { name: 'Writing suggestion' })).toBeTruthy();
    finish('Written while away');
    await userEvent.click(await screen.findByRole('button', { name: 'See suggestion' }));
    await within(await dialog()).findByText('Written while away');
  });

  it('keeps a finished suggestion when its dialog is closed, until it is discarded', async () => {
    renderDetails();
    await ask();
    await within(await dialog()).findByText('A fuller description');
    await userEvent.click(backdrop());
    await userEvent.click(screen.getByRole('button', { name: 'See suggestion' }));
    await userEvent.click(await within(await dialog()).findByRole('button', { name: 'Discard' }));
    expect(screen.getByRole('button', { name: 'Improve description' })).toBeTruthy();
    expect(calls.cancel).not.toHaveBeenCalled();
    expect(calls.updateTask).not.toHaveBeenCalled();
  });

  it('ignores the answer of a suggestion that was cancelled', async () => {
    const finish = pending();
    renderDetails();
    await ask();
    await userEvent.click(await within(await dialog()).findByRole('button', { name: 'Cancel' }));
    finish('Too late');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Improve description' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'See suggestion' })).toBeNull();
  });

  it('shows it on a backlog row with a name that says what is happening', async () => {
    pending();
    render(
      <table>
        <tbody>
          <IdeaRow task={task} selected={false} onSelect={() => {}} picked={false} onPick={() => {}} onChanged={async () => undefined} onMakeTask={() => {}} onDragStart={() => {}} onDropHere={() => {}} />
        </tbody>
      </table>,
    );
    await ask('Improve the description of Fix the login');
    await userEvent.click(backdrop());
    expect(screen.getByRole('button', { name: 'Writing a suggestion for Fix the login. Show it' })).toBeTruthy();
  });
});

describe('improving the description from a backlog row', () => {
  it('opens the suggestion without opening the row, and saves only the description', async () => {
    const onSelect = vi.fn();
    render(
      <table>
        <tbody>
          <IdeaRow task={task} selected={false} onSelect={onSelect} picked={false} onPick={() => {}} onChanged={async () => undefined} onMakeTask={() => {}} onDragStart={() => {}} onDropHere={() => {}} />
        </tbody>
      </table>,
    );
    await ask('Improve the description of Fix the login');
    await userEvent.click(await within(await dialog()).findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(calls.updateTask).toHaveBeenCalledWith('one', { description: 'A fuller description' }));
    expect(calls.suggest).toHaveBeenCalledWith(expect.objectContaining({ key: 'one-row', description: 'Staging only' }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('improving the description of a new task', () => {
  const company = companySchema.parse({ id: 'c', name: 'Client', color: '#5BB8A6', projects: [{ id: 'api', name: 'api', path: '/a' }] });
  const snapshot = { companies: [company], tasks: [], sessions: [], accounts: { accounts: [] }, reviews: {}, guideNewTasks: false } as unknown as Snapshot;

  it('needs a title or a description first', () => {
    render(<NewTaskPage snapshot={snapshot} initialDraft={startDraft(snapshot, 'c')} onCreated={async () => undefined} onChanged={async () => undefined} />);
    expect(screen.getByRole('button', { name: 'Improve description' })).toHaveProperty('disabled', true);
  });

  it('fills the description field without creating the task', async () => {
    render(<NewTaskPage snapshot={snapshot} initialDraft={startDraft(snapshot, 'c')} onCreated={async () => undefined} onChanged={async () => undefined} />);
    await userEvent.type(screen.getByLabelText('Task title'), 'Add export');
    await ask();
    await userEvent.click(await within(await dialog()).findByRole('button', { name: 'Accept' }));
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('A fuller description');
    expect(calls.createTask).not.toHaveBeenCalled();
    expect(calls.updateTask).not.toHaveBeenCalled();
    const request = calls.suggest.mock.calls[0]?.[0] as SuggestionRequest;
    expect(request).toMatchObject({ companyId: 'c', title: 'Add export', projectIds: ['api'] });
    expect(request.key).toMatch(/^new-task-/);
  });
});
