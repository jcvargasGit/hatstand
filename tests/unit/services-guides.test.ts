import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGuideService } from '../../src/main/services/guides';
import { DRAFT_IN_THE_WAY } from '../../src/shared/task-summary';
import { makeHome, type TestHome } from '../helpers/home';
import { fakeServiceDeps, makeServiceContext } from '../helpers/services';

let home: TestHome;
beforeEach(() => {
  home = makeHome('hatstand-guide-services-');
  home.store.createCompany('Acme', '#112233');
});
afterEach(() => home.remove());

function setup() {
  const { ctx } = makeServiceContext(home);
  const deps = fakeServiceDeps();
  return { guides: createGuideService(ctx, deps), sessions: deps.sessions };
}

const origins = async (guides: ReturnType<typeof setup>['guides']) =>
  Object.fromEntries((await guides.listPlaybooks('acme')).playbooks.map((playbook) => [playbook.id, playbook.origin]));

describe('the guides of a client', () => {
  it('starts with the built-in guides', async () => {
    expect(await origins(setup().guides)).toMatchObject({ implement: 'built-in', bug: 'built-in', 'pr-review': 'built-in' });
  });

  it('creates a guide of the client from its name, and removes it', async () => {
    const { guides } = setup();
    const file = await guides.createPlaybook('acme', '  Deploy checklist ');
    expect(file).toBe(`${home.paths.playbooksDir('acme')}/deploy-checklist.yaml`);
    expect((await origins(guides))['deploy-checklist']).toBe('client');
    await guides.removePlaybook('acme', 'deploy-checklist');
    expect(existsSync(file)).toBe(false);
    expect(await origins(guides)).not.toHaveProperty('deploy-checklist');
  });

  it('customizes a built-in guide once, and only a built-in one', async () => {
    const { guides } = setup();
    await guides.customizePlaybook('acme', 'bug');
    expect((await origins(guides)).bug).toBe('customized');
    await expect(guides.customizePlaybook('acme', 'bug')).rejects.toThrow('There is already a guide file called bug.yaml.');
    await expect(guides.customizePlaybook('acme', 'deploy')).rejects.toThrow('Only a built-in guide can be customized.');
  });

  it('will not take the name of a built-in guide, nor remove one', async () => {
    const { guides } = setup();
    await expect(guides.createPlaybook('acme', 'Bug')).rejects.toThrow('A built-in guide already uses this name.');
    await expect(guides.createPlaybook('acme', '!!!')).rejects.toThrow('Name the guide with at least one letter or number.');
    await expect(guides.removePlaybook('acme', 'implement')).rejects.toThrow('A built-in guide cannot be removed.');
  });
});

describe('the guide of a task', () => {
  const task = () => home.store.updateTask(home.store.createTask({ companyId: 'acme', title: 'Fix login' }).id, { type: 'investigation' });

  it('starts a guide from its first step, through the sessions, and the guide decides the type from then on', async () => {
    const { guides, sessions } = setup();
    const { id } = task();
    await guides.setTaskGuide(id, 'bug');
    expect(sessions.changeGuide).toHaveBeenCalledExactlyOnceWith(id, expect.objectContaining({ playbookId: 'bug', current: 0, done: [], promptPending: true }));
    expect(home.store.findTask(id).type).toBeUndefined();
  });

  it('keeps the task as it was when the session cannot take the new step', async () => {
    const { guides, sessions } = setup();
    vi.mocked(sessions.changeGuide).mockImplementation(() => {
      throw new Error(DRAFT_IN_THE_WAY);
    });
    const { id } = task();
    await expect(guides.setTaskGuide(id, 'bug')).rejects.toThrow(DRAFT_IN_THE_WAY);
    expect(home.store.findTask(id).type).toBe('investigation');
  });

  it('refuses a guide that no longer exists, before reaching the sessions', async () => {
    const { guides, sessions } = setup();
    await expect(guides.setTaskGuide(task().id, 'gone')).rejects.toThrow('This guide no longer exists.');
    expect(sessions.changeGuide).not.toHaveBeenCalled();
  });

  it('takes the guide and its type away, without reaching the sessions', async () => {
    const { guides, sessions } = setup();
    const { id } = task();
    home.store.updateTask(id, { guide: { playbookId: 'bug', name: 'Bug', steps: [{ name: 'Read', prompt: 'Read.' }], current: 0, promptPending: false, done: [] } });
    await guides.setTaskGuide(id, null);
    expect(home.store.findTask(id).guide).toBeUndefined();
    expect(home.store.findTask(id).type).toBeUndefined();
    expect(sessions.changeGuide).not.toHaveBeenCalled();
  });

  it('moves to a step through the sessions, which write its prompt', async () => {
    const { guides, sessions } = setup();
    await guides.moveGuideStep('task-1', 2);
    expect(sessions.moveGuideStep).toHaveBeenCalledExactlyOnceWith('task-1', 2);
    await guides.setGuideAutoContinue('task-1', true);
    expect(sessions.setGuideAutoContinue).toHaveBeenCalledExactlyOnceWith('task-1', true);
  });
});
