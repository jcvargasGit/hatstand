import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceService } from '../../src/main/services/workspace';
import type { TaskReview } from '../../src/shared/schemas';
import { makeHome, type TestHome } from '../helpers/home';
import { fakeServiceDeps, makeServiceContext } from '../helpers/services';

let home: TestHome;
beforeEach(() => {
  home = makeHome('hatstand-workspace-services-');
  home.store.createCompany('Acme', '#112233');
  home.store.createCompany('Globex', '#223344');
});
afterEach(() => home.remove());

function setup() {
  const { ctx } = makeServiceContext(home);
  const deps = fakeServiceDeps();
  return { workspace: createWorkspaceService(ctx, deps), deps };
}

describe('what the interface draws', () => {
  it('is everything saved, with the latest pull request reviews', async () => {
    const task = home.store.createTask({ companyId: 'acme', title: 'Fix login' });
    const review: TaskReview = { pulls: [], checkedAt: '2026-01-01T00:00:00Z' };
    const { workspace, deps } = setup();
    vi.mocked(deps.reviews.all).mockReturnValue({ [task.id]: review });
    const snapshot = await workspace.getSnapshot();
    expect(snapshot.companies.map((company) => company.id).sort()).toEqual(['acme', 'globex']);
    expect(snapshot.tasks.map((item) => item.id)).toEqual([task.id]);
    expect(snapshot.reviews).toEqual({ [task.id]: review });
  });
});

describe('searching everything', () => {
  it('finds tasks by their notes and the files of each client, across clients', async () => {
    const task = home.store.createTask({ companyId: 'acme', title: 'Fix login' });
    home.store.writeNotes(task, 'The session cookie expires too early.');
    mkdirSync(home.paths.knowledgeDir('globex'), { recursive: true });
    writeFileSync(join(home.paths.knowledgeDir('globex'), 'cookies.md'), 'How the cookie banner works.');

    const { results, partial } = await setup().workspace.searchEverything('cookie');
    expect(partial).toBe(false);
    expect(results).toContainEqual(expect.objectContaining({ kind: 'task', taskId: task.id, companyId: 'acme' }));
    expect(results).toContainEqual(expect.objectContaining({ kind: 'file', companyId: 'globex', path: join(home.paths.knowledgeDir('globex'), 'cookies.md') }));
  });

  it('finds nothing for words that appear nowhere', async () => {
    home.store.createTask({ companyId: 'acme', title: 'Fix login' });
    expect((await setup().workspace.searchEverything('zebra')).results).toEqual([]);
  });
});
