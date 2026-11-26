// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BacklogChat } from '../../src/renderer/src/components/BacklogChat';
import { InboxPage } from '../../src/renderer/src/components/InboxPage';
import type { Bridge, Snapshot } from '../../src/shared/api';
import type { ChatAnswer, ChatRequest } from '../../src/shared/backlog-chat';
import { companySchema, taskSchema } from '../../src/shared/schemas';

const exportAnswer: ChatAnswer = {
  answer: 'The export is **already done**.',
  related: [
    { taskId: 'done-1', number: 3, title: 'Export invoices', status: 'done', archived: false },
    { taskId: 'idea-1', number: 8, title: 'Export as PDF', status: 'idea', archived: false },
  ],
};

const calls = vi.hoisted(() => ({
  ask: vi.fn(async (_request: unknown): Promise<unknown> => undefined),
  cancel: vi.fn(async (_key: string) => undefined),
}));

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: {
    askBacklogChat: (request: unknown) => calls.ask(request),
    cancelBacklogChat: (key: string) => calls.cancel(key),
  },
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

beforeEach(() => {
  vi.clearAllMocks();
  calls.ask.mockResolvedValue(exportAnswer);
  window.hatstand = { invoke: vi.fn(), on: () => () => {} } as unknown as Bridge;
});
afterEach(cleanup);

const acme = companySchema.parse({ id: 'acme', name: 'Acme', color: '#112233' });
const globex = companySchema.parse({ id: 'globex', name: 'Globex', color: '#445566' });
const onOpenTask = vi.fn();
const openChat = () => userEvent.click(screen.getByRole('button', { name: 'Already done or planned?' }));
const renderChat = async (companyId: string | null = 'acme') => {
  render(<BacklogChat companies={[acme, globex]} companyId={companyId} onOpenTask={onOpenTask} />);
  await openChat();
};
const chat = () => within(screen.getByRole('region', { name: 'Backlog chat' }));
const field = () => chat().getByRole<HTMLTextAreaElement>('textbox');
const askButton = () => chat().getByRole<HTMLButtonElement>('button', { name: 'Ask' });
const askFor = async (question: string) => {
  await userEvent.type(field(), question);
  await userEvent.click(askButton());
};
const lastRequest = () => calls.ask.mock.calls.at(-1)?.[0] as ChatRequest;

describe('the backlog chat', () => {
  it('starts closed, and keeps the conversation when it is closed and opened again', async () => {
    render(<BacklogChat companies={[acme, globex]} companyId="acme" onOpenTask={onOpenTask} />);
    expect(chat().queryByRole('textbox')).toBeNull();
    await openChat();
    await askFor('Do we export invoices?');
    await chat().findByText('already done');
    await openChat();
    expect(chat().queryByText('already done')).toBeNull();
    await openChat();
    expect(chat().getByText('already done')).toBeTruthy();
  });

  it('sends the question and shows the answer with the related tasks and their status', async () => {
    await renderChat();
    expect(askButton().disabled).toBe(true);
    await askFor('Do we export invoices?');

    expect(lastRequest()).toEqual({ key: 'backlog-chat:acme', companyId: 'acme', question: 'Do we export invoices?', history: [] });
    expect(await chat().findByText('already done')).toBeTruthy();
    expect(chat().getByText('Do we export invoices?')).toBeTruthy();
    expect(field().value).toBe('');
    const related = within(chat().getByRole('list', { name: 'Related tasks' }));
    expect(related.getByRole('button', { name: /#3.*Export invoices.*done/ })).toBeTruthy();
    expect(related.getByRole('button', { name: /#8.*Export as PDF.*backlog/ })).toBeTruthy();
  });

  it('sends with Enter, and adds a line with Shift and Enter', async () => {
    await renderChat();
    await userEvent.type(field(), 'First line{Shift>}{Enter}{/Shift}second line');
    expect(calls.ask).not.toHaveBeenCalled();
    await userEvent.type(field(), '{Enter}');
    expect(lastRequest().question).toBe('First line\nsecond line');
  });

  it('opens a related task for the client the question was about', async () => {
    await renderChat();
    await askFor('Do we export invoices?');
    await userEvent.click(await chat().findByRole('button', { name: /Export invoices/ }));
    expect(onOpenTask).toHaveBeenCalledWith('done-1', 'acme');
  });

  it('sends the earlier turns with a follow-up, and starts over on request', async () => {
    await renderChat();
    await askFor('Do we export invoices?');
    await chat().findByText('already done');
    calls.ask.mockResolvedValue({ answer: 'PDF is in the backlog.', related: [] });
    await userEvent.type(chat().getByRole('textbox', { name: 'Ask a follow-up' }), 'And as PDF?{Enter}');

    expect(lastRequest()).toMatchObject({
      question: 'And as PDF?',
      history: [
        { role: 'person', text: 'Do we export invoices?' },
        { role: 'assistant', text: 'The export is **already done**.' },
      ],
    });
    expect(await chat().findByText('PDF is in the backlog.')).toBeTruthy();

    await userEvent.click(chat().getByRole('button', { name: 'New conversation' }));
    expect(chat().queryByText('PDF is in the backlog.')).toBeNull();
    await askFor('Anything about login?');
    expect(lastRequest().history).toEqual([]);
  });

  it('shows why there is no answer, and asks the same question again on Try again', async () => {
    calls.ask.mockRejectedValueOnce(new Error('The agent took more than 2 minutes. Try again, or ask a shorter question.'));
    await renderChat();
    await askFor('Do we export invoices?');

    const alert = await chat().findByRole('alert');
    expect(alert.textContent).toContain('No answer for “Do we export invoices?”: The agent took more than 2 minutes.');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(calls.ask).toHaveBeenCalledTimes(2);
    expect(lastRequest().question).toBe('Do we export invoices?');
    expect(await chat().findByText('already done')).toBeTruthy();
    expect(chat().queryByRole('alert')).toBeNull();
  });

  it('stops a question, gives the text back, and ignores the answer that arrives late', async () => {
    let answerLate: (answer: ChatAnswer) => void = () => {};
    calls.ask.mockReturnValueOnce(new Promise((resolve) => (answerLate = resolve)));
    await renderChat();
    await askFor('Do we export invoices?');
    expect(chat().getByRole('status', { name: 'The agent is reading the tasks' })).toBeTruthy();

    await userEvent.click(chat().getByRole('button', { name: 'Stop' }));
    expect(calls.cancel).toHaveBeenCalledWith('backlog-chat:acme');
    expect(field().value).toBe('Do we export invoices?');
    answerLate(exportAnswer);
    await waitFor(() => expect(askButton().disabled).toBe(false));
    expect(chat().queryByText('already done')).toBeNull();
  });

  it('asks about one client, chosen by the person when the page shows every client', async () => {
    await renderChat(null);
    await askFor('Do we export invoices?');
    expect(lastRequest().companyId).toBe('acme');
    await chat().findByText('already done');

    await userEvent.selectOptions(chat().getByRole('combobox', { name: 'Client to ask about' }), 'globex');
    expect(chat().queryByText('already done')).toBeNull();
    await askFor('Do we export invoices?');
    expect(lastRequest()).toMatchObject({ key: 'backlog-chat:globex', companyId: 'globex', history: [] });
  });

  it('has no client to choose on the page of one client', async () => {
    await renderChat('acme');
    expect(chat().queryByRole('combobox')).toBeNull();
  });
});

describe('the chat on the Backlog page', () => {
  const idea = taskSchema.parse({ id: 'idea-1', number: 8, companyId: 'acme', title: 'Export as PDF', status: 'idea', createdAt: 'x', updatedAt: 'x' });
  const snapshot = { companies: [acme], accounts: { accounts: [] }, tasks: [idea], sessions: [], reviews: {} } as unknown as Snapshot;

  it('opens a related backlog item in its details, and any other task as a task', async () => {
    const openTask = vi.fn();
    render(<InboxPage snapshot={snapshot} companyId="acme" onOpenTask={openTask} onMakeTask={() => {}} onChanged={async () => undefined} />);
    await openChat();
    await askFor('Do we export invoices?');

    await userEvent.click(await chat().findByRole('button', { name: /Export as PDF/ }));
    expect(await screen.findByRole('complementary', { name: 'Backlog item details' })).toBeTruthy();
    expect(openTask).not.toHaveBeenCalled();

    await userEvent.click(chat().getByRole('button', { name: /Export invoices/ }));
    expect(openTask).toHaveBeenCalledWith('done-1', 'acme');
  });
});
