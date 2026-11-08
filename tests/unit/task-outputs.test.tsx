// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bridge, TaskOutput } from '../../src/shared/api';
import { TaskOutputs } from '../../src/renderer/src/components/TaskOutputs';

const report: TaskOutput = { name: 'report.md', updatedAt: '2026-11-06T10:00:00.000Z' };

function open(outputs: TaskOutput[]) {
  const invoke = vi.fn(async (method: string) => {
    if (method === 'listTaskOutputs') return outputs;
    if (method === 'readTaskOutput') return '# Findings\n\nThe queue is slow.';
    if (method === 'getEditorName') return 'VS Code';
    return undefined;
  });
  window.hatstand = { invoke, on: () => () => {} } as unknown as Bridge;
  const view = render(<TaskOutputs taskId="t1" />);
  return { invoke, view };
}

afterEach(cleanup);

describe('the output of the agent in a task', () => {
  it('stays out of the way when the agent wrote nothing', async () => {
    const { invoke, view } = open([]);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('listTaskOutputs', 't1'));
    expect(view.container.textContent).toBe('');
  });

  it('reads a report inside the task', async () => {
    open([report]);
    await userEvent.click(await screen.findByRole('button', { name: 'Read report.md' }));
    expect(await screen.findByText('The queue is slow.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Hide report.md' }));
    expect(screen.queryByText('The queue is slow.')).toBeNull();
  });

  it('opens a report in the editor', async () => {
    const { invoke } = open([report]);
    await userEvent.click(await screen.findByRole('button', { name: /^Open report\.md in/ }));
    expect(invoke).toHaveBeenCalledWith('openTaskOutputInEditor', 't1', 'report.md');
  });
});
