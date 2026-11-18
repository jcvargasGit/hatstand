import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBacklogService } from '../../src/main/services/backlog';
import { createCodeCopies } from '../../src/main/services/code-copies';
import { createTaskService } from '../../src/main/services/tasks';
import { prepareWorktrees, type RemoveReport } from '../../src/main/worktrees';
import type { Task, TaskWorktree } from '../../src/shared/schemas';
import { makeCommittedRepo, makeHome, type TestHome } from '../helpers/home';
import { fakeCopies, fakeServiceDeps, makeServiceContext } from '../helpers/services';

let home: TestHome;
beforeEach(() => {
  home = makeHome('hatstand-task-services-');
  home.store.saveCompany({ ...home.store.createCompany('Acme', '#112233'), projects: [{ id: 'api', name: 'api', path: makeCommittedRepo(home.folder('code', 'api')) }] });
});
afterEach(() => home.remove());

const taskWithCopy = async (title = 'Fix it'): Promise<Task> => {
  const { store, paths } = home;
  const task = store.createTask({ companyId: 'acme', title, projectIds: ['api'] });
  const company = store.readCompany('acme');
  const worktrees = await prepareWorktrees({ paths, company, task, repos: company.projects, path: process.env.PATH ?? '' });
  return store.setTaskCode(task.id, worktrees);
};

describe('removing the copies of the code of a task', () => {
  it('removes a clean copy, and the task forgets it', async () => {
    const task = await taskWithCopy();
    const [copy] = task.worktrees;
    const report = await createCodeCopies(makeServiceContext(home).ctx).removeCopies(task.id, true);
    expect(report).toEqual({ removed: [copy?.path], kept: [] });
    expect(existsSync(copy?.path ?? '')).toBe(false);
    expect(home.store.findTask(task.id).worktrees).toEqual([]);
  });

  it('keeps a copy with work that is not committed, and says why when only clean copies may go', async () => {
    const task = await taskWithCopy();
    const [copy] = task.worktrees;
    writeFileSync(join(copy?.path ?? '', 'draft.txt'), 'work in progress');
    const copies = createCodeCopies(makeServiceContext(home).ctx);

    await expect(copies.removeCopies(task.id, true)).rejects.toThrow(`api: ${copy?.path} has files that are not committed.`);
    expect(home.store.findTask(task.id).worktrees).toEqual(task.worktrees);

    const report = await copies.removeCopies(task.id, false);
    expect(report.kept.map((item) => item.name)).toEqual(['api']);
    expect(existsSync(join(copy?.path ?? '', 'draft.txt'))).toBe(true);
  });

  it('forgets a copy whose folder is already gone', async () => {
    const task = home.store.setTaskCode(home.store.createTask({ companyId: 'acme', title: 'Old' }).id, [{ projectId: 'api', path: join(home.root, 'gone'), branch: 'hatstand/old', base: 'HEAD' }]);
    const report = await createCodeCopies(makeServiceContext(home).ctx).removeCopies(task.id, true);
    expect(report.removed).toEqual([join(home.root, 'gone')]);
    expect(home.store.findTask(task.id).worktrees).toEqual([]);
  });

  it('keeps a copy the task got while its other copies were being removed', async () => {
    const { store } = home;
    const old: TaskWorktree = { projectId: 'api', path: join(home.root, 'old'), branch: 'hatstand/old', base: 'HEAD' };
    const added: TaskWorktree = { projectId: 'web', path: join(home.root, 'added'), branch: 'hatstand/added', base: 'HEAD' };
    const task = store.setTaskCode(store.createTask({ companyId: 'acme', title: 'Fix it' }).id, [old]);
    let finishRemoving = (_report: RemoveReport) => {};
    const removing = new Promise<RemoveReport>((resolve) => {
      finishRemoving = resolve;
    });
    const remove = vi.fn(() => removing);

    const removal = createCodeCopies(makeServiceContext(home).ctx, remove).removeCopies(task.id, true);
    store.setTaskCode(task.id, [old, added]);
    finishRemoving({ removed: [old.path], kept: [] });
    await removal;

    expect(remove).toHaveBeenCalledOnce();
    expect(store.findTask(task.id).worktrees).toEqual([added]);
  });
});

describe('the task handlers that remove copies', () => {
  it('will not remove the copies of a task with a running session', async () => {
    const { ctx, stateChanges } = makeServiceContext(home);
    const deps = fakeServiceDeps();
    vi.mocked(deps.sessions.hasLiveSession).mockReturnValue(true);
    const copies = fakeCopies();
    const tasks = createTaskService(ctx, { ...deps, copies });
    const task = home.store.createTask({ companyId: 'acme', title: 'Fix it' });

    await expect(tasks.removeTaskCopies(task.id)).rejects.toThrow('Stop the session before removing the copy of the code.');
    await expect(tasks.deleteTask(task.id)).rejects.toThrow('Stop the session before deleting this task.');
    expect(copies.removeCopies).not.toHaveBeenCalled();
    expect(home.store.findTask(task.id).id).toBe(task.id);
    expect(stateChanges()).toBe(0);
  });

  it('removes only clean copies, then tells the interface', async () => {
    const { ctx, stateChanges } = makeServiceContext(home);
    const copies = fakeCopies();
    const task = home.store.createTask({ companyId: 'acme', title: 'Fix it' });
    await createTaskService(ctx, { ...fakeServiceDeps(), copies }).removeTaskCopies(task.id);
    expect(copies.removeCopies).toHaveBeenCalledExactlyOnceWith(task.id, true);
    expect(stateChanges()).toBe(1);
  });

  it('keeps a task whose copies cannot be removed', async () => {
    const { ctx, stateChanges } = makeServiceContext(home);
    const copies = fakeCopies(vi.fn(async () => Promise.reject(new Error('api: has files that are not committed.'))));
    const task = home.store.createTask({ companyId: 'acme', title: 'Fix it' });
    const tasks = createTaskService(ctx, { ...fakeServiceDeps(), copies });

    await expect(tasks.deleteTask(task.id)).rejects.toThrow('not committed');
    expect(home.store.findTask(task.id).id).toBe(task.id);
    expect(stateChanges()).toBe(0);
  });

  it('deletes a task once its copies are gone', async () => {
    const { ctx, stateChanges } = makeServiceContext(home);
    const task = await taskWithCopy();
    await createTaskService(ctx, { ...fakeServiceDeps(), copies: createCodeCopies(ctx) }).deleteTask(task.id);
    expect(home.store.listTasks('acme')).toEqual([]);
    expect(existsSync(task.worktrees[0]?.path ?? '')).toBe(false);
    expect(stateChanges()).toBe(1);
  });
});

describe('adding ideas to the backlog', () => {
  it('adds them after the last one, in the order given, with their checklists', async () => {
    const { ctx, stateChanges } = makeServiceContext(home);
    home.store.createTask({ companyId: 'acme', title: 'First', rank: 0 });
    home.store.createTask({ companyId: 'acme', title: 'Last', rank: 4 });
    home.store.createTask({ companyId: 'acme', title: 'Unranked' });
    await createBacklogService(ctx).addIdeas('acme', [{ title: 'Export', description: 'As CSV', checklist: ['Header row'] }, { title: 'Email it' }]);

    const ideas = home.store.listTasks('acme').filter((task) => task.status === 'idea').sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    expect(ideas.map(({ title, rank }) => ({ title, rank }))).toEqual([{ title: 'Export', rank: 5 }, { title: 'Email it', rank: 6 }]);
    expect(ideas[0]).toMatchObject({ description: 'As CSV', checklist: [expect.objectContaining({ text: 'Header row' })] });
    expect(stateChanges()).toBe(1);
  });

  it('starts an empty backlog at the top', async () => {
    await createBacklogService(makeServiceContext(home).ctx).addIdeas('acme', [{ title: 'First' }]);
    expect(home.store.listTasks('acme').map((task) => task.rank)).toEqual([0]);
  });

  it('adds none when one of them is not valid', async () => {
    const { ctx, stateChanges } = makeServiceContext(home);
    await expect(createBacklogService(ctx).addIdeas('acme', [{ title: 'Fine' }, { title: '' }])).rejects.toThrow();
    expect(home.store.listTasks('acme')).toEqual([]);
    expect(stateChanges()).toBe(0);
  });
});
