// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changesHint, TaskChanges } from '../../src/renderer/src/components/TaskChanges';
import type { Bridge, RepoChanges } from '../../src/shared/api';
import { taskSchema, type OutsideChanges } from '../../src/shared/schemas';

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

describe('the changes of a task outside git', () => {
  const outside: OutsideChanges = {
    folders: [
      {
        folder: '/acme/planning',
        changes: [
          { path: '/acme/planning/q3/roadmap.md', status: 'added' },
          { path: '/acme/planning/old-plan.md', status: 'deleted' },
          { path: '/acme/planning/tool', status: 'repository' },
        ],
      },
      { folder: '/acme/knowledge', changes: [{ path: '/acme/knowledge/glossary.md', status: 'modified' }] },
    ],
    truncated: false,
  };
  const answerOutside = (found: OutsideChanges, repos: RepoChanges[] = []) =>
    invoke.mockImplementation(async (method: string) => (method === 'taskChanges' ? repos : method === 'taskOutsideChanges' ? found : method === 'taskOutsideFile' ? '+# Roadmap' : 'Code'));

  it('lists each file with its full path and what happened to it, by folder', async () => {
    answerOutside(outside);
    render(<TaskChanges task={task} refreshKey="x" />);
    const group = await screen.findByRole('group', { name: 'Outside git' });
    expect(within(group).getByRole('heading', { name: '/acme/planning' })).toBeTruthy();
    expect(within(group).getByRole('heading', { name: '/acme/knowledge' })).toBeTruthy();
    const row = (path: string) => within(group).getByTitle(path);
    expect(within(row('/acme/planning/q3/roadmap.md')).getByText('added')).toBeTruthy();
    expect(within(row('/acme/planning/old-plan.md')).getByText('deleted')).toBeTruthy();
    expect(within(row('/acme/planning/tool')).getByText('new repository')).toBeTruthy();
    expect(within(row('/acme/knowledge/glossary.md')).getByText('modified')).toBeTruthy();
    expect(screen.getByText('4 files outside git')).toBeTruthy();
    expect(screen.queryByText(/has not changed any/)).toBeNull();
  });

  it('opens a file in the editor with a click, except a deleted one', async () => {
    answerOutside(outside);
    render(<TaskChanges task={task} refreshKey="x" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Open /acme/planning/q3/roadmap.md in editor' }));
    expect(invoke).toHaveBeenCalledWith('openTaskChangedFile', 't', '/acme/planning/q3/roadmap.md');
    expect(screen.queryByRole('button', { name: 'Open /acme/planning/old-plan.md in editor' })).toBeNull();
  });

  it('shows the content of a new file when its row is clicked', async () => {
    answerOutside(outside);
    render(<TaskChanges task={task} refreshKey="x" />);
    await userEvent.click(await screen.findByTitle('/acme/planning/q3/roadmap.md'));
    expect(invoke).toHaveBeenCalledWith('taskOutsideFile', 't', '/acme/planning/q3/roadmap.md');
    expect(within(screen.getByLabelText('Changes in /acme/planning/q3/roadmap.md')).getByText('+# Roadmap')).toBeTruthy();
  });

  it('shows no group when nothing changed outside git, and says so when nothing changed at all', async () => {
    answerOutside({ folders: [], truncated: false });
    render(<TaskChanges task={task} refreshKey="x" />);
    expect(await screen.findByText('This task has not changed any file yet.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Outside git' })).toBeNull();
  });

  it('says when the list is not complete', async () => {
    answerOutside({ ...outside, truncated: true });
    render(<TaskChanges task={task} refreshKey="x" />);
    expect(await screen.findByText(/too large to follow in full/)).toBeTruthy();
  });

  it('counts repositories and files outside git together in the heading', () => {
    expect(changesHint(0, 0)).toBe('This task has not changed any file yet.');
    expect(changesHint(2, 0)).toBe('In 2 repositories');
    expect(changesHint(0, 1)).toBe('1 file outside git');
    expect(changesHint(1, 3)).toBe('In 1 repository, 3 files outside git');
  });
});
