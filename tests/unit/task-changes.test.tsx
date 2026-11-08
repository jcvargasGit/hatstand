// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskChanges } from '../../src/renderer/src/components/TaskChanges';
import type { Bridge, RepoChanges } from '../../src/shared/api';
import { taskSchema } from '../../src/shared/schemas';

const invoke = vi.fn();
const task = taskSchema.parse({ id: 't', companyId: 'c', title: 'An RFC', status: 'doing', createdAt: 'x', updatedAt: 'x', isolated: false });
const report = (change: Partial<RepoChanges>): RepoChanges => ({ projectId: 'api', name: 'api', path: '/code/api', isRepo: true, branch: 'dev', changes: [], before: [], committed: [], commits: 0, truncated: false, ...change });
const answer = (reports: RepoChanges[]) => invoke.mockImplementation(async (method: string) => (method === 'taskChanges' ? reports : 'diff'));

beforeEach(() => {
  invoke.mockReset();
  window.hatstand = { invoke, on: () => () => {} } as unknown as Bridge;
});
afterEach(cleanup);

describe('the changes of a task', () => {
  it('shows what changed since the agent started, and hides repositories with only older files', async () => {
    answer([
      report({ changes: [{ path: 'rfc.md', status: 'untracked' }], before: [{ path: 'tools/old.sh', status: 'untracked' }] }),
      report({ projectId: 'web', name: 'web', before: [{ path: 'old.txt', status: 'modified' }] }),
    ]);
    render(<TaskChanges task={task} refreshKey="x" />);
    expect(await screen.findByText('rfc.md')).toBeTruthy();
    expect(screen.queryByText('tools/old.sh')).toBeNull();
    expect(screen.queryByText('web')).toBeNull();
    expect(screen.getByText(/2 files were already changed before the agent started/)).toBeTruthy();
  });

  it('reveals the older files on request', async () => {
    answer([report({ before: [{ path: 'tools/old.sh', status: 'untracked' }] })]);
    render(<TaskChanges task={task} refreshKey="x" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Show it' }));
    expect(screen.getByRole('heading', { name: 'Already changed before the agent started' })).toBeTruthy();
    const file = screen.getByRole('button', { name: /tools\/old\.sh/ });
    await userEvent.click(file);
    expect(invoke).toHaveBeenCalledWith('taskFileDiff', 't', 'api', 'tools/old.sh');
    await userEvent.click(screen.getByRole('button', { name: 'Hide them' }));
    expect(within(document.body).queryByText('tools/old.sh')).toBeNull();
  });
});
