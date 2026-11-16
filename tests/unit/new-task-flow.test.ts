// What stands behind the New task flow in the main process: the prompt that sends itself, the windows, and what the editor may open.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptPrefill } from '../../src/main/agents/prompt-prefill';
import { buildStepPrompt } from '../../src/main/agents/task-prompt';
import { BUILTIN_PLAYBOOKS } from '../../src/main/builtin-playbooks';
import { editorTarget } from '../../src/main/editor-target';
import { startGuide } from '../../src/main/playbooks';
import { Store } from '../../src/main/store';
import { taskKnowledgeFolder } from '../../src/main/task-folders';
import { newTaskWindowQuery, windowOptions } from '../../src/main/windows';
import { newTaskDraftSchema } from '../../src/shared/new-task-draft';
import { companySchema, preferencesSchema, taskSchema } from '../../src/shared/schemas';
import { taskTypeOf } from '../../src/shared/task-types';
import { makeHome, type TestHome } from '../helpers/home';

describe('sending the opening prompt without Enter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const start = (sends = true) => {
    const events: string[] = [];
    const prefill = new PromptPrefill('Go', (text) => events.push(text), sends ? () => events.push('<enter>') : undefined);
    return { events, prefill };
  };

  it('sends Enter shortly after the prompt is written', () => {
    const { events, prefill } = start();
    prefill.onOutput('Welcome');
    vi.advanceTimersByTime(700);
    expect(events).toEqual(['Go']);
    vi.advanceTimersByTime(300);
    expect(events).toEqual(['Go', '<enter>']);
    vi.advanceTimersByTime(60_000);
    expect(events).toEqual(['Go', '<enter>']);
  });

  it('waits behind the trust dialog, then writes and sends once the person answers it', () => {
    const { events, prefill } = start();
    prefill.onOutput('Do you trust the files in this folder?');
    vi.advanceTimersByTime(60_000);
    expect(events).toEqual([]);
    prefill.onInput('\r');
    prefill.onOutput('Welcome');
    vi.advanceTimersByTime(1500);
    expect(events).toEqual(['Go']);
    vi.advanceTimersByTime(300);
    expect(events).toEqual(['Go', '<enter>']);
  });

  it('waits for the person to press Enter when the setting is off', () => {
    const { events, prefill } = start(false);
    prefill.onOutput('Welcome');
    vi.advanceTimersByTime(60_000);
    expect(events).toEqual(['Go']);
  });

  it('leaves the prompt to the person who typed over it before it was sent', () => {
    const { events, prefill } = start();
    prefill.onOutput('Welcome');
    vi.advanceTimersByTime(800);
    prefill.onInput('x');
    vi.advanceTimersByTime(60_000);
    expect(events).toEqual(['Go']);
  });

  it('sends nothing when the session ends first', () => {
    const { events, prefill } = start();
    prefill.onOutput('Welcome');
    vi.advanceTimersByTime(800);
    prefill.cancel();
    vi.advanceTimersByTime(60_000);
    expect(events).toEqual(['Go']);
  });
});

describe('the windows of Hatstand', () => {
  const options = (headless: boolean) => windowOptions({ kind: 'new-task', title: 'New task', preload: '/preload.js', headless, dark: false });

  it('keeps the New task window hidden in a headless run, as the main window', () => {
    expect(options(true).show).toBe(false);
    expect(windowOptions({ kind: 'main', title: 'Hatstand', preload: '/preload.js', headless: true, dark: true }).show).toBe(false);
    expect(options(false).show).toBe(true);
  });

  it('never gives the page access to Node', () => {
    expect(options(false).webPreferences).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true, preload: '/preload.js' });
  });

  it('tells the page which draft to show', () => {
    expect(newTaskWindowQuery('d1')).toEqual({ 'new-task': 'd1' });
  });
});

describe('the draft that moves to a window of its own', () => {
  const draft = { title: 'Export invoices', description: 'Half a\nsentence', companyId: 'acme', playbookId: 'bug', areaId: 'pay', accountId: 'claude', priority: 'high', isolated: false, projectIds: ['api', 'web'], guideChosen: true, areaChosen: true, ideaId: 'idea-1' };

  it('carries the title, the description and every setting unchanged', () => {
    expect(newTaskDraftSchema.parse(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
  });

  it('refuses a draft that is not one, since it comes from a page', () => {
    expect(newTaskDraftSchema.safeParse({ ...draft, projectIds: 'api' }).success).toBe(false);
    expect(newTaskDraftSchema.safeParse({ title: 'x' }).success).toBe(false);
  });
});

describe('what the editor may open', () => {
  let testHome: TestHome;
  beforeEach(() => {
    testHome = makeHome('hatstand-editor-');
  });
  afterEach(() => testHome.remove());

  it('opens a folder of the client, a file inside it, and a document of the task, and nothing else', () => {
    const repo = testHome.folder('code', 'api');
    const copy = testHome.folder('copies', 'api');
    mkdirSync(join(copy, 'src'));
    writeFileSync(join(copy, 'src', 'login.ts'), '');
    const document = join(testHome.folder('tasks'), 't.plan.md');
    writeFileSync(document, '# Plan');
    const outside = join(testHome.folder('other'), 'secret.txt');
    writeFileSync(outside, '');
    const target = (path: string) => editorTarget([repo, copy], [document], path);

    expect(target(repo)).toEqual({ kind: 'folder', path: repo });
    expect(target(copy)).toEqual({ kind: 'folder', path: copy });
    expect(target(join(copy, 'src', 'login.ts'))).toEqual({ kind: 'file', path: join(copy, 'src', 'login.ts') });
    expect(target(document)).toEqual({ kind: 'file', path: document });
    expect(target(outside)).toBeNull();
    expect(target(join(copy, '..', '..', 'other', 'secret.txt'))).toBeNull();
    expect(target(`${repo}-private`)).toBeNull();
  });
});

describe('data saved before this change', () => {
  it('loads a task whose guide has no finished steps saved', () => {
    const task = taskSchema.parse({ id: 't', companyId: 'acme', title: 'Old', status: 'doing', createdAt: 'x', updatedAt: 'x', guide: { playbookId: 'bug', name: 'Investigate a bug', current: 1, promptPending: false, steps: [{ name: 'a', prompt: 'b' }, { name: 'c', prompt: 'd' }] } });
    expect(task.guide?.done).toEqual([]);
    expect(task.guide?.current).toBe(1);
  });

  it('starts every guide count at zero, and sends the first prompt by itself', () => {
    const preferences = preferencesSchema.parse({ todayLayout: 'list', guideNewTasks: false });
    expect(preferences.guideUsage).toEqual({});
    expect(preferences.autoSendPrompt).toBe(true);
    expect(preferences.guideNewTasks).toBe(false);
  });
});

describe('the settings kept with the person', () => {
  let testHome: TestHome;
  beforeEach(() => {
    testHome = makeHome('hatstand-preferences-');
  });
  afterEach(() => testHome.remove());

  it('reads preferences written before the guide counts existed', () => {
    mkdirSync(testHome.paths.home, { recursive: true });
    writeFileSync(testHome.paths.preferencesFile, 'todayLayout: list\nguideNewTasks: true\n');
    expect(testHome.store.snapshot()).toMatchObject({ guideUsage: {}, autoSendPrompt: true });
  });

  it('keeps the guide counts and the auto-send choice across a restart', () => {
    testHome.store.recordGuideUse('rfc');
    testHome.store.recordGuideUse('rfc');
    testHome.store.recordGuideUse('bug');
    testHome.store.savePreferences({ autoSendPrompt: false });
    expect(new Store(testHome.paths).snapshot()).toMatchObject({ guideUsage: { rfc: 2, bug: 1 }, autoSendPrompt: false });
  });
});

describe('the guide for an investigation', () => {
  const guide = BUILTIN_PLAYBOOKS['investigation'];
  const started = () => startGuide({ id: 'investigation', origin: 'built-in', ...guide! });
  const company = companySchema.parse({ id: 'acme', name: 'Acme', color: '#5BB8A6', subdomains: [{ id: 'pay', name: 'Payments' }] });

  it('is a guide of the investigation type', () => {
    expect(guide?.name).toBe('Investigate a topic');
    expect(taskTypeOf({ guide: started() }, company)).toBe('investigation');
  });

  it('ends with a Markdown file in the knowledge folder, and creates no tasks', () => {
    const last = guide?.steps.at(-1);
    expect(last?.prompt).toContain('{knowledge}');
    expect(last?.prompt).toMatch(/\.md/);
    expect(last?.prompt).toMatch(/not create (any )?tasks/i);
    expect(guide?.steps.every((step) => !step.approval)).toBe(true);
  });

  it('saves the result in the folder of the area of the task, or in the knowledge of the client', () => {
    const testHome = makeHome('hatstand-knowledge-');
    const inArea = taskKnowledgeFolder(testHome.paths, company, { subdomainId: 'pay' });
    const noArea = taskKnowledgeFolder(testHome.paths, company, {});
    expect(inArea).toBe(testHome.paths.areaDir('acme', 'pay'));
    expect(noArea).not.toBe(inArea);
    const task = taskSchema.parse({ id: 't', companyId: 'acme', title: 'Look into exports', status: 'doing', createdAt: 'x', updatedAt: 'x', subdomainId: 'pay', guide: { ...started(), current: (guide?.steps.length ?? 1) - 1 } });
    const prompt = buildStepPrompt(task, [], inArea);
    expect(prompt).toContain(inArea);
    expect(prompt).not.toContain('{knowledge}');
    testHome.remove();
  });
});
