// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskIssueLink } from '../../src/renderer/src/components/TaskIssueLink';
import type { Bridge } from '../../src/shared/api';
import { taskSchema } from '../../src/shared/schemas';

const invoke = vi.fn();
const task = (change: Record<string, unknown> = {}) =>
  taskSchema.parse({ id: 't', number: 46, companyId: 'c', title: 'Fix it', status: 'doing', createdAt: 'x', updatedAt: 'x', ...change });

beforeEach(() => {
  invoke.mockReset();
  window.hatstand = { invoke, on: () => () => {} } as unknown as Bridge;
});

afterEach(cleanup);

describe('TaskIssueLink', () => {
  it('links an issue the person pastes, and refreshes', async () => {
    const onChanged = vi.fn(async () => {});
    render(<TaskIssueLink task={task()} onChanged={onChanged} />);
    expect(screen.getByRole('button', { name: 'Link' })).toHaveProperty('disabled', true);
    await userEvent.type(screen.getByLabelText('Issue link or key'), 'acme/api#12');
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('linkTaskIssue', 't', 'acme/api#12'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows why a link was refused', async () => {
    invoke.mockRejectedValueOnce(new Error('acme/api#12 is already linked to task #3.'));
    render(<TaskIssueLink task={task()} onChanged={vi.fn(async () => {})} />);
    await userEvent.type(screen.getByLabelText('Issue link or key'), 'acme/api#12');
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(await screen.findByText(/already linked to task #3/)).toBeTruthy();
  });

  it('shows the linked issue next to the local number, and unlinks it', async () => {
    render(<TaskIssueLink task={task({ source: { kind: 'github', key: 'acme/api#12', url: 'https://github.com/acme/api/issues/12' } })} onChanged={vi.fn(async () => {})} />);
    expect(screen.getByRole('link', { name: 'acme/api#12' }).getAttribute('href')).toBe('https://github.com/acme/api/issues/12');
    expect(screen.getByText(/keeps #46/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('unlinkTaskIssue', 't'));
  });
});
