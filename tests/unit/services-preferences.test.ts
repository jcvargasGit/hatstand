import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPreferenceService } from '../../src/main/services/preferences';
import type { StayAwakeMode, TodayLayout } from '../../src/shared/schemas';
import { makeHome, type TestHome } from '../helpers/home';
import { makeServiceContext } from '../helpers/services';

let home: TestHome;
beforeEach(() => {
  home = makeHome('hatstand-preference-services-');
});
afterEach(() => home.remove());

function setup(active = false) {
  const { ctx, stateChanges } = makeServiceContext(home);
  const applyStayAwake = vi.fn(() => {
    // The mode is saved before it is applied, so applying reads the new one.
    modeWhenApplied.push(home.store.readPreferences().stayAwake);
  });
  const modeWhenApplied: StayAwakeMode[] = [];
  return { preferences: createPreferenceService(ctx, { stayAwake: { active }, applyStayAwake }), applyStayAwake, modeWhenApplied, stateChanges };
}

describe('staying awake', () => {
  it('reports the saved mode, and whether the computer is kept awake now', async () => {
    expect(await setup(true).preferences.getStayAwake()).toEqual({ mode: 'off', active: true });
  });

  it('saves the mode, then applies it', async () => {
    const { preferences, modeWhenApplied, stateChanges } = setup();
    await preferences.setStayAwake('sessions');
    expect(home.store.readPreferences().stayAwake).toBe('sessions');
    expect(modeWhenApplied).toEqual(['sessions']);
    expect(stateChanges()).toBe(1);
  });

  it('refuses a mode it does not know, and changes nothing', async () => {
    const { preferences, applyStayAwake, stateChanges } = setup();
    await expect(preferences.setStayAwake('forever' as StayAwakeMode)).rejects.toThrow();
    expect(home.store.readPreferences().stayAwake).toBe('off');
    expect(applyStayAwake).not.toHaveBeenCalled();
    expect(stateChanges()).toBe(0);
  });
});

describe('the other preferences', () => {
  it('saves the order of the clients', async () => {
    const { preferences, stateChanges } = setup();
    await preferences.setClientOrder(['globex', 'acme']);
    expect(home.store.readPreferences().clientOrder).toEqual(['globex', 'acme']);
    expect(stateChanges()).toBe(1);
  });

  it('saves the layout of Today, and refuses one it does not know', async () => {
    const { preferences } = setup();
    await preferences.setTodayLayout('board');
    expect(home.store.readPreferences().todayLayout).toBe('board');
    await expect(preferences.setTodayLayout('grid' as TodayLayout)).rejects.toThrow();
    expect(home.store.readPreferences().todayLayout).toBe('board');
  });

  it('turns guides for new tasks and sending the first prompt on only when asked with true', async () => {
    const { preferences } = setup();
    await preferences.setGuideNewTasks(true);
    await preferences.setAutoSendPrompt(true);
    expect(home.store.readPreferences()).toMatchObject({ guideNewTasks: true, autoSendPrompt: true });
    await preferences.setGuideNewTasks('yes' as unknown as boolean);
    await preferences.setAutoSendPrompt(1 as unknown as boolean);
    expect(home.store.readPreferences()).toMatchObject({ guideNewTasks: false, autoSendPrompt: false });
  });
});
