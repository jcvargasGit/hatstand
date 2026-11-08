// @vitest-environment jsdom
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { taskRepoChanges } from '../../src/main/git-changes';
import { inspectHook, installPreCommitHook } from '../../src/main/guard/install';
import { guardRepos, removeControlRepoHooks } from '../../src/main/guard/service';
import { planningConflict, withPlanningRepo } from '../../src/main/planning';
import { taskRepositories } from '../../src/main/task-folders';
import { RepoPicker } from '../../src/renderer/src/components/RepoPicker';
import { companySchema, taskSchema } from '../../src/shared/schemas';
import { isControlRepo, repoToCopy, workRepositories } from '../../src/shared/work-repos';

const PATH = process.env.PATH ?? '';
let dir: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-control-')));
});
afterEach(() => {
  cleanup();
  rmSync(dir, { recursive: true, force: true });
});

const client = (change: Record<string, unknown> = {}) =>
  companySchema.parse({
    id: 'c',
    name: 'Client',
    color: '#5BB8A6',
    projects: [
      { id: 'api', name: 'api', path: '/code/api' },
      { id: 'specs', name: 'specs', path: '/code/specs' },
    ],
    ...change,
  });
const planningIn = (path: string) => ({ planning: { path, places: [] } });

describe('a repository that holds planning and context', () => {
  it('is the planning repository, or contains it', () => {
    expect(isControlRepo(client(planningIn('/code/specs')), { path: '/code/specs' })).toBe(true);
    expect(isControlRepo(client(planningIn('/code/specs/planning')), { path: '/code/specs' })).toBe(true);
    expect(isControlRepo(client(planningIn('/code/specs')), { path: '/code/specs/tool' })).toBe(true);
    expect(isControlRepo(client(planningIn('/code/specs')), { path: '/code/specs-extra' })).toBe(false);
  });

  it('is a repository that is a knowledge or skills folder', () => {
    const company = client({ context: { knowledgeDir: '/code/specs' } });
    expect(workRepositories(company).map((repo) => repo.id)).toEqual(['api']);
  });

  it('stays a work repository when only a subfolder of it is knowledge', () => {
    const company = client({ context: { knowledgeDir: '/code/api/docs' } });
    expect(workRepositories(company).map((repo) => repo.id)).toEqual(['api', 'specs']);
  });

  it('is not offered when choosing repositories', () => {
    render(<RepoPicker company={client(planningIn('/code/specs'))} selected={[]} onChange={() => undefined} />);
    expect(screen.getByRole('checkbox', { name: 'api' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'specs' })).toBeNull();
  });

  it('does not get a copy', () => {
    const company = client(planningIn('/code/specs'));
    expect(repoToCopy(company, 'api').id).toBe('api');
    expect(() => repoToCopy(company, 'specs')).toThrow(/does not get a copy/);
    expect(() => repoToCopy(company, 'nope')).toThrow('Its repositories are: api.');
  });

  it('does not count for a task, even if a task selected it before', () => {
    const company = client(planningIn('/code/specs'));
    const task = taskSchema.parse({ id: 't', companyId: 'c', title: 'Fix', status: 'doing', createdAt: 'x', updatedAt: 'x', projectIds: ['api', 'specs'] });
    expect(taskRepositories(company, task).map((repo) => repo.id)).toEqual(['api']);
  });

  it('is not listed as changed in the shared folder', async () => {
    const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e.dev', ...args], { cwd, stdio: 'pipe' });
    const makeRepo = (name: string) => {
      const path = join(dir, name);
      mkdirSync(path);
      git(path, 'init', '-q', '-b', 'main');
      writeFileSync(join(path, 'a.txt'), 'one\n');
      git(path, 'add', '.');
      git(path, 'commit', '-qm', 'first');
      writeFileSync(join(path, 'edit.txt'), 'edit\n');
      return path;
    };
    const api = makeRepo('api');
    const specs = makeRepo('specs');
    const company = client({
      projects: [
        { id: 'api', name: 'api', path: api },
        { id: 'specs', name: 'specs', path: specs },
      ],
      ...planningIn(specs),
    });
    const task = taskSchema.parse({ id: 't', companyId: 'c', title: 'Fix', status: 'doing', createdAt: 'x', updatedAt: 'x', isolated: false });
    expect((await taskRepoChanges(company, task, PATH, new Date(0).toISOString())).map((report) => report.name)).toEqual(['api']);
  });
});

describe('commit protection and control repositories', () => {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e.dev', ...args], { cwd, stdio: 'pipe' });
  const makeRepo = (name: string) => {
    const path = join(dir, name);
    mkdirSync(path);
    git(path, 'init', '-q', '-b', 'main');
    return path;
  };
  const protect = (path: string) => expect(installPreCommitHook(path, process.execPath, join(dir, 'guard.cjs')).installed).toBe(true);

  it('protects only work repositories', () => {
    expect(guardRepos(client(planningIn('/code/specs')))).toEqual([{ name: 'api', path: '/code/api' }]);
  });

  it('removes the hook from a control repository, and leaves work repositories alone', () => {
    const api = makeRepo('api');
    const specs = makeRepo('specs');
    protect(api);
    protect(specs);
    const company = client({
      projects: [
        { id: 'api', name: 'api', path: api },
        { id: 'specs', name: 'specs', path: specs },
      ],
      ...planningIn(specs),
    });
    expect(removeControlRepoHooks(company, [])).toEqual([specs]);
    expect(inspectHook(specs).state).toBe('missing');
    expect(inspectHook(api).state).toBe('protected');
  });

  it('keeps a hook that is not from Hatstand', () => {
    const specs = makeRepo('specs');
    writeFileSync(join(specs, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    expect(removeControlRepoHooks(client({ projects: [], ...planningIn(specs) }), [])).toEqual([]);
    expect(inspectHook(specs).state).toBe('existing-hook');
  });

  it('keeps the hook when another client works in that repository', () => {
    const specs = makeRepo('specs');
    protect(specs);
    const other = client({ id: 'other', projects: [{ id: 'specs', name: 'specs', path: specs }] });
    expect(removeControlRepoHooks(client({ projects: [], ...planningIn(specs) }), [other])).toEqual([]);
    expect(inspectHook(specs).state).toBe('protected');
  });
});

describe('choosing a registered repository as the planning repository', () => {
  it('moves it out of the repositories', () => {
    const saved = withPlanningRepo(client(), '/code/specs', []);
    expect(saved.projects.map((repo) => repo.id)).toEqual(['api']);
    expect(saved.planning?.path).toBe('/code/specs');
  });

  it('waits until no task has a copy of it', () => {
    const specs = join(dir, 'specs');
    mkdirSync(join(specs, '.git'), { recursive: true });
    const company = client({ projects: [{ id: 'specs', name: 'specs', path: specs }] });
    const worktree = { projectId: 'specs', path: '/copy', branch: 'b', base: 'main' };
    const task = taskSchema.parse({ id: 't', companyId: 'c', title: 'Fix', status: 'doing', createdAt: 'x', updatedAt: 'x', worktrees: [worktree] });
    expect(planningConflict(company, specs, join(dir, 'home'), [task])).toMatch(/Fix/);
    expect(planningConflict(company, specs, join(dir, 'home'), [])).toBeNull();
  });
});
