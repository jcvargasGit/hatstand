// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PathPicker } from '../../src/renderer/src/components/PathPicker';
import type { Bridge } from '../../src/shared/api';

const invoke = vi.fn();

beforeEach(() => {
  invoke.mockReset();
  window.hatstand = { invoke, on: () => () => {} } as unknown as Bridge;
});

afterEach(cleanup);

const renderPicker = (onSelect = vi.fn()) => {
  render(<PathPicker kind="directory" label="Knowledge" browseLabel="Add folder" onSelect={onSelect} />);
  return onSelect;
};

describe('PathPicker', () => {
  it('adds a pasted path after checking it, and clears the field', async () => {
    invoke.mockResolvedValue('/Users/dev/.claude/knowledge');
    const onSelect = renderPicker();

    await userEvent.type(screen.getByLabelText('Knowledge, full path'), '~/.claude/knowledge');
    await userEvent.click(screen.getByRole('button', { name: 'Add path' }));

    expect(invoke).toHaveBeenCalledWith('resolvePath', '~/.claude/knowledge', 'directory');
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('/Users/dev/.claude/knowledge'));
    expect(screen.getByLabelText<HTMLInputElement>('Knowledge, full path').value).toBe('');
  });

  it('adds a pasted path with the Enter key', async () => {
    invoke.mockResolvedValue('/docs');
    const onSelect = renderPicker();
    await userEvent.type(screen.getByLabelText('Knowledge, full path'), '/docs{Enter}');
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('/docs'));
  });

  it('shows why a path failed and keeps it to fix', async () => {
    invoke.mockRejectedValue(new Error('/nope does not exist. Check the spelling.'));
    const onSelect = renderPicker();

    await userEvent.type(screen.getByLabelText('Knowledge, full path'), '/nope');
    await userEvent.click(screen.getByRole('button', { name: 'Add path' }));

    expect(await screen.findByText(/does not exist/)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Knowledge, full path').value).toBe('/nope');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('adds the folder chosen in the system dialog, and nothing when it is cancelled', async () => {
    invoke.mockResolvedValueOnce(null);
    const onSelect = renderPicker();
    await userEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    expect(onSelect).not.toHaveBeenCalled();

    invoke.mockResolvedValueOnce('/chosen');
    await userEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('/chosen'));
  });

  it('does not submit a form around it', async () => {
    const onSubmit = vi.fn((event: Event) => event.preventDefault());
    invoke.mockResolvedValue('/docs');
    const { container } = render(
      <form>
        <PathPicker kind="directory" label="Folder" browseLabel="Choose" onSelect={vi.fn()} />
      </form>,
    );
    container.querySelector('form')?.addEventListener('submit', onSubmit);
    await userEvent.type(screen.getByLabelText('Folder, full path'), '/docs{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
