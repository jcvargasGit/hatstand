import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTaskWithGuide, makeTaskFromIdea } from '../../src/main/task-setup';
import type { TaskGuide } from '../../src/shared/schemas';
import { makeHome, type TestHome } from '../helpers/home';

let testHome: TestHome;

beforeEach(() => {
  testHome = makeHome('hatstand-task-setup-');
  testHome.store.createCompany('Acme', '#112233');
});

afterEach(() => testHome.remove());

const deps = (changeGuide = vi.fn((taskId: string, guide: TaskGuide) => void testHome.store.updateTask(taskId, { guide }))) => ({ store: testHome.store, paths: testHome.paths, changeGuide });
const idea = () => testHome.store.createTask({ companyId: 'acme', title: 'Export is slow' }, undefined, 'idea');

describe('creating a task with a guide', () => {
  it('starts the guide and remembers that it was used', () => {
    const task = createTaskWithGuide(deps(), { companyId: 'acme', title: 'Fix the export', playbookId: 'implement' });
    expect(task.guide).toMatchObject({ playbookId: 'implement', current: 0, done: [] });
    createTaskWithGuide(deps(), { companyId: 'acme', title: 'Fix it again', playbookId: 'implement' });
    createTaskWithGuide(deps(), { companyId: 'acme', title: 'No guide' });
    expect(testHome.store.snapshot().guideUsage).toEqual({ implement: 2 });
  });

  it('refuses a guide that does not exist, and creates nothing counted', () => {
    expect(() => createTaskWithGuide(deps(), { companyId: 'acme', title: 'Odd', playbookId: 'missing' })).toThrow('no longer exists');
    expect(testHome.store.snapshot().guideUsage).toEqual({});
  });
});

describe('turning an inbox item into a task', () => {
  it('keeps the same task, with the choices of a new task', () => {
    const item = idea();
    const changeGuide = vi.fn((taskId: string, guide: TaskGuide) => void testHome.store.updateTask(taskId, { guide }));
    const task = makeTaskFromIdea(deps(changeGuide), item.id, {
      title: 'Make the export faster',
      description: 'It takes a minute for big clients.',
      subdomainId: testHome.store.readCompany('acme').defaultAreaId,
      projectIds: ['r-api'],
      playbookId: 'bug',
      priority: 'high',
      isolated: false,
    });
    expect(task).toMatchObject({ id: item.id, number: item.number, status: 'todo', title: 'Make the export faster', customTitle: true, description: 'It takes a minute for big clients.', projectIds: ['r-api'], priority: 'high', isolated: false });
    expect(changeGuide).toHaveBeenCalledWith(item.id, expect.objectContaining({ playbookId: 'bug', current: 0 }));
    expect(testHome.store.findTask(item.id).guide?.playbookId).toBe('bug');
    expect(testHome.store.snapshot().guideUsage).toEqual({ bug: 1 });
  });

  it('works without a guide, and keeps the title as written when it did not change', () => {
    const item = idea();
    const task = makeTaskFromIdea(deps(), item.id, { title: 'Export is slow' });
    expect(task.status).toBe('todo');
    expect(task.customTitle).toBeUndefined();
    expect(task.guide).toBeUndefined();
  });

  it('refuses a task that is no longer in the inbox, or a missing title', () => {
    const item = idea();
    expect(() => makeTaskFromIdea(deps(), item.id, { title: '  ' })).toThrow('Write a task title.');
    makeTaskFromIdea(deps(), item.id, { title: 'Export is slow' });
    expect(() => makeTaskFromIdea(deps(), item.id, { title: 'Again' })).toThrow('This is already a task.');
  });
});
