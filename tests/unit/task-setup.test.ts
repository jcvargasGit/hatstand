import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTaskWithGuide, makeTaskFromIdea, saveTaskDraft } from '../../src/main/task-setup';
import { newTaskDraftSchema, UNTITLED_DRAFT, type NewTaskDraft } from '../../src/shared/new-task-draft';
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

describe('saving the New task form as a draft', () => {
  const form = (fields: Partial<NewTaskDraft> = {}): NewTaskDraft => newTaskDraftSchema.parse({ companyId: 'acme', title: 'Half a title', description: 'Half a sentence', ...fields });
  const backlog = (companyId = 'acme') => testHome.store.listTasks(companyId).filter((task) => task.status === 'idea');

  it('keeps it in the backlog of its client, marked as a draft, with the choices of the form', () => {
    const area = testHome.store.readCompany('acme').defaultAreaId;
    const id = saveTaskDraft(testHome.store, null, form({ playbookId: 'bug', guideChosen: true, areaId: area, areaChosen: true, projectIds: ['r-api'], priority: 'high', isolated: false, suggestionKey: 'new-task-1' }));
    expect(backlog()).toHaveLength(1);
    expect(testHome.store.findTask(id as string)).toMatchObject({
      status: 'idea',
      title: 'Half a title',
      description: 'Half a sentence',
      subdomainId: area,
      projectIds: ['r-api'],
      priority: 'high',
      isolated: false,
      draft: { playbookId: 'bug', guideChosen: true, areaChosen: true, untitled: false, suggestionKey: 'new-task-1' },
    });
  });

  it('writes the same draft again as the person types, and never a second one', () => {
    const id = saveTaskDraft(testHome.store, null, form());
    expect(saveTaskDraft(testHome.store, id, form({ title: 'A whole title' }))).toBe(id);
    expect(backlog().map((task) => task.title)).toEqual(['A whole title']);
  });

  it('gives a draft without a title a placeholder, and remembers the person wrote none', () => {
    const id = saveTaskDraft(testHome.store, null, form({ title: '  ' })) as string;
    expect(testHome.store.findTask(id)).toMatchObject({ title: UNTITLED_DRAFT, draft: { untitled: true } });
    saveTaskDraft(testHome.store, id, form({ title: 'Now it has one' }));
    expect(testHome.store.findTask(id)).toMatchObject({ title: 'Now it has one', draft: { untitled: false } });
  });

  it('keeps nothing for an empty form, and removes the draft of a form emptied again', () => {
    expect(saveTaskDraft(testHome.store, null, form({ title: '', description: ' ' }))).toBeNull();
    expect(backlog()).toEqual([]);
    const id = saveTaskDraft(testHome.store, null, form());
    expect(saveTaskDraft(testHome.store, id, form({ title: '', description: '' }))).toBeNull();
    expect(backlog()).toEqual([]);
  });

  it('moves to the backlog of another client when the form changes client', () => {
    testHome.store.createCompany('Other', '#445566');
    const id = saveTaskDraft(testHome.store, null, form());
    const moved = saveTaskDraft(testHome.store, id, form({ companyId: 'other' }));
    expect(moved).not.toBe(id);
    expect(backlog()).toEqual([]);
    expect(backlog('other').map((task) => task.id)).toEqual([moved]);
  });

  it('starts a new draft when the one it had is gone or is no longer a draft, and leaves that one alone', () => {
    const kept = idea();
    const id = saveTaskDraft(testHome.store, kept.id, form());
    expect(id).not.toBe(kept.id);
    expect(testHome.store.findTask(kept.id)).toMatchObject({ title: 'Export is slow' });
    expect(saveTaskDraft(testHome.store, 'missing', form())).not.toBeNull();
    expect(backlog()).toHaveLength(3);
  });

  it('never deletes a backlog item that is not a draft, even for an empty form', () => {
    const kept = idea();
    expect(saveTaskDraft(testHome.store, kept.id, form({ title: '', description: '' }))).toBeNull();
    expect(testHome.store.findTask(kept.id).title).toBe('Export is slow');
  });

  it('stops being a draft once it becomes a task', () => {
    const id = saveTaskDraft(testHome.store, null, form({ playbookId: 'bug', guideChosen: true })) as string;
    const task = makeTaskFromIdea(deps(), id, { title: 'Half a title', playbookId: 'bug' });
    expect(task).toMatchObject({ id, status: 'todo' });
    expect(task.draft).toBeUndefined();
    expect(testHome.store.findTask(id).draft).toBeUndefined();
  });
});
