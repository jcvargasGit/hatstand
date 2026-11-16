// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskNumber } from '../../src/renderer/src/components/TaskNumber';
import { TaskReferenceCopy } from '../../src/renderer/src/components/TaskReferenceCopy';
import { taskSchema, type Task } from '../../src/shared/schemas';

const UUID = '26780f88-9c57-48ee-b47c-9092f792dfc7';
const task = (status: Task['status'], change: Record<string, unknown> = {}): Task =>
  taskSchema.parse({ id: UUID, number: 12, companyId: 'acme', title: 'Fix login', status, createdAt: 'x', updatedAt: 'x', ...change });

const withClipboard = (writeText: (text: string) => Promise<void>) => {
  userEvent.setup();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
};

afterEach(cleanup);

describe('TaskNumber', () => {
  it('shows the client with the number, so the same number in two clients reads differently', () => {
    render(<TaskNumber task={task('doing')} />);
    render(<TaskNumber task={task('doing', { companyId: 'globex' })} />);
    expect(screen.getByText('acme#12')).toBeTruthy();
    expect(screen.getByText('globex#12')).toBeTruthy();
  });
});

describe('TaskReferenceCopy', () => {
  it.each(['idea', 'doing'] as const)('shows and copies the reference of a task that is %s', async (status) => {
    const writeText = vi.fn(async () => {});
    withClipboard(writeText);
    render(<TaskReferenceCopy task={task(status)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy reference acme#12' }));
    expect(writeText).toHaveBeenCalledWith('acme#12');
    expect((await screen.findByRole('status')).textContent).toBe('Copied acme#12');
  });

  it('copies the UUID, also before the task has a number', async () => {
    const writeText = vi.fn(async () => {});
    withClipboard(writeText);
    render(<TaskReferenceCopy task={task('idea', { number: undefined })} />);
    expect(screen.queryByRole('button', { name: /Copy reference/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Copy UUID' }));
    expect(writeText).toHaveBeenCalledWith(UUID);
  });

  it('says why when the clipboard refuses', async () => {
    withClipboard(vi.fn(async () => Promise.reject(new Error('The clipboard is not available.'))));
    render(<TaskReferenceCopy task={task('doing')} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy reference acme#12' }));
    expect(await screen.findByText('The clipboard is not available.')).toBeTruthy();
  });
});
