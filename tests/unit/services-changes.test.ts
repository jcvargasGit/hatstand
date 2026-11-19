import { execFileSync } from 'node:child_process';
import { utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChangeService } from '../../src/main/services/changes';
import { prepareWorktrees } from '../../src/main/worktrees';
import type { Task } from '../../src/shared/schemas';
import { makeCommittedRepo, makeHome, type TestHome } from '../helpers/home';
import { makeServiceContext } from '../helpers/services';

const commit = (cwd: string, message: string) => {
  execFileSync('git', ['add', '.'], { cwd });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', message], { cwd });
};

let home: TestHome;
let api: string;
beforeEach(() => {
  home = makeHome('hatstand-change-services-');
  api = makeCommittedRepo(home.folder('code', 'api'));
  home.store.saveCompany({ ...home.store.createCompany('Acme', '#112233'), projects: [{ id: 'api', name: 'api', path: api }] });
});
afterEach(() => home.remove());

const changes = () => createChangeService(makeServiceContext(home).ctx, { sessions: { outsideChangesSettled: async () => {} } });

describe('the changes in the planning repository', () => {
  it('are none while there is no planning repository, or it is not one', async () => {
    expect(await changes().planningStatus('acme')).toBeNull();
    home.store.saveCompany({ ...home.store.readCompany('acme'), planning: { path: home.folder('plans'), places: [] } });
    expect(await changes().planningStatus('acme')).toBeNull();
  });

  it('list what is not committed yet', async () => {
    const plans = makeCommittedRepo(home.folder('plans'));
    writeFileSync(join(plans, 'README.md'), 'changed\n');
    home.store.saveCompany({ ...home.store.readCompany('acme'), planning: { path: plans, places: [] } });
    expect(await changes().planningStatus('acme')).toEqual({
      projectId: 'planning',
      name: 'Planning repository',
      path: plans,
      isRepo: true,
      branch: 'main',
      changes: [{ path: 'README.md', status: 'modified' }],
      before: [],
      committed: [],
      commits: 0,
      truncated: false,
    });
  });
});

describe('the changes of a task', () => {
  const taskWithCopy = async (): Promise<Task> => {
    const task = home.store.createTask({ companyId: 'acme', title: 'Fix login', projectIds: ['api'] });
    const company = home.store.readCompany('acme');
    return home.store.setTaskCode(task.id, await prepareWorktrees({ paths: home.paths, company, task, repos: company.projects, path: process.env.PATH ?? '' }));
  };

  it('show the work in its copy: what is committed on its branch, and what is not yet', async () => {
    const task = await taskWithCopy();
    const copy = task.worktrees[0]?.path ?? '';
    writeFileSync(join(copy, 'login.ts'), 'export {};\n');
    commit(copy, 'Add login');
    writeFileSync(join(copy, 'README.md'), 'changed\n');

    const [report] = await changes().taskChanges(task.id);
    expect(report).toMatchObject({ projectId: 'api', path: copy, changes: [{ path: 'README.md', status: 'modified' }], committed: [{ path: 'login.ts', status: 'added' }], commits: 1 });
    expect(await changes().taskFileDiff(task.id, 'api', 'README.md')).toContain('+changed');
    expect(await changes().taskFileDiff(task.id, 'api', 'login.ts')).toContain('+export {};');
  });

  it('tell the changes made before the first session from those made since, in a shared folder', async () => {
    const task = home.store.updateTask(home.store.createTask({ companyId: 'acme', title: 'Fix login', projectIds: ['api'] }).id, { isolated: false });
    const startedAt = new Date(Date.now() - 60_000);
    home.store.saveSession({ id: '00000000-0000-4000-8000-000000000001', taskId: task.id, companyId: 'acme', accountId: 'a', cwd: api, state: 'stopped', startedAt: startedAt.toISOString(), updatedAt: startedAt.toISOString() });
    writeFileSync(join(api, 'old.txt'), 'from before');
    utimesSync(join(api, 'old.txt'), new Date(startedAt.getTime() - 60_000), new Date(startedAt.getTime() - 60_000));
    writeFileSync(join(api, 'new.txt'), 'from the agent');

    const [report] = await changes().taskChanges(task.id);
    expect(report?.before).toEqual([{ path: 'old.txt', status: 'untracked' }]);
    expect(report?.changes).toEqual([{ path: 'new.txt', status: 'untracked' }]);
  });

  it('show nothing for a task without changes, and refuse a diff that no longer applies', async () => {
    const task = await taskWithCopy();
    expect(await changes().taskChanges(task.id)).toEqual([]);
    await expect(changes().taskFileDiff(task.id, 'api', 'README.md')).rejects.toThrow('This file no longer has changes.');
    await expect(changes().taskFileDiff(task.id, 'gone', 'README.md')).rejects.toThrow('This repository is no longer part of this client.');
  });
});
