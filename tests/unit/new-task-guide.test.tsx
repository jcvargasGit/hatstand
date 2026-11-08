// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewTaskPage } from '../../src/renderer/src/components/NewTaskPage';
import { NewTasksSection } from '../../src/renderer/src/components/NewTasksSection';
import type { Bridge, Snapshot } from '../../src/shared/api';
import { companySchema, preferencesSchema } from '../../src/shared/schemas';

const createTask = vi.fn(async (_input: unknown) => ({ id: 't' }));
const setGuideNewTasks = vi.fn(async (_enabled: boolean) => undefined);
const playbooks = [
  { id: 'implement', name: 'Implement a task', steps: [], origin: 'built-in' },
  { id: 'rfc', name: 'RFC', steps: [], origin: 'built-in' },
];

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: {
    createTask: (input: unknown) => createTask(input),
    setGuideNewTasks: (enabled: boolean) => setGuideNewTasks(enabled),
    listPlaybooks: async () => ({ playbooks, problems: [] }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.hatstand = { invoke: vi.fn(), on: () => () => {} } as unknown as Bridge;
});
afterEach(cleanup);

const company = companySchema.parse({ id: 'c', name: 'Client', color: '#5BB8A6', projects: [{ id: 'api', name: 'api', path: '/a' }] });
const snapshot = (guideNewTasks: boolean) => ({ companies: [company], tasks: [], sessions: [], accounts: { accounts: [] }, reviews: {}, guideNewTasks }) as unknown as Snapshot;
const renderPage = (guideNewTasks: boolean) => render(<NewTaskPage snapshot={snapshot(guideNewTasks)} initialCompanyId="c" onCreated={async () => undefined} onChanged={async () => undefined} />);
const guide = () => screen.getByLabelText(/^Guide/) as HTMLSelectElement;

describe('the guide of a new task', () => {
  it('starts on Implement a task when the setting is on', async () => {
    renderPage(true);
    await screen.findByRole('option', { name: 'Implement a task' });
    expect(guide().value).toBe('implement');
  });

  it('is the only choice of what kind of work it is, and saves no type', async () => {
    renderPage(true);
    await screen.findByRole('option', { name: 'RFC' });
    expect(screen.queryByLabelText(/^Type/)).toBeNull();
    await userEvent.selectOptions(guide(), 'rfc');
    await userEvent.type(screen.getByLabelText('Task title'), 'Write it');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ playbookId: 'rfc' }));
    expect(createTask.mock.calls[0]?.[0]).not.toHaveProperty('type');
  });

  it('stays empty when the setting is off', async () => {
    renderPage(false);
    await screen.findByRole('option', { name: 'Implement a task' });
    expect(guide().value).toBe('');
    await userEvent.type(screen.getByLabelText('Task title'), 'Fix it');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ playbookId: undefined }));
  });

  it('prefers the default guide of the client over the guide of the type', async () => {
    const data = { ...snapshot(true), companies: [{ ...company, defaultPlaybookId: 'rfc' }] };
    render(<NewTaskPage snapshot={data} initialCompanyId="c" onCreated={async () => undefined} onChanged={async () => undefined} />);
    await screen.findByRole('option', { name: 'RFC' });
    expect(guide().value).toBe('rfc');
    await userEvent.selectOptions(guide(), 'implement');
    expect(guide().value).toBe('implement');
  });

  it('uses the default guide of the client when the setting is off', async () => {
    const data = { ...snapshot(false), companies: [{ ...company, defaultPlaybookId: 'rfc' }] };
    render(<NewTaskPage snapshot={data} initialCompanyId="c" onCreated={async () => undefined} onChanged={async () => undefined} />);
    await screen.findByRole('option', { name: 'RFC' });
    expect(guide().value).toBe('rfc');
  });

  it('can still be chosen by hand when the setting is off', async () => {
    renderPage(false);
    await screen.findByRole('option', { name: 'RFC' });
    await userEvent.selectOptions(guide(), 'rfc');
    expect(guide().value).toBe('rfc');
  });
});

describe('the setting', () => {
  it('is on by default, also in preferences saved before it existed', () => {
    expect(preferencesSchema.parse({}).guideNewTasks).toBe(true);
  });

  it('saves your choice', async () => {
    const onChanged = vi.fn(async () => undefined);
    render(<NewTasksSection enabled onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Start with the guide Implement a task' }));
    expect(setGuideNewTasks).toHaveBeenCalledWith(false);
    expect(onChanged).toHaveBeenCalled();
  });
});
