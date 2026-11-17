import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { combineHandlers, createServices, DESKTOP_METHODS, serviceParts } from '../../src/main/services';
import { createSessionService } from '../../src/main/services/sessions';
import { makeHome, type TestHome } from '../helpers/home';
import { fakeServiceDeps, makeServiceContext } from '../helpers/services';

// Loading any of these would mean a service needs the desktop app or a real terminal to be tested.
vi.mock('electron', () => {
  throw new Error('A service loaded Electron.');
});
vi.mock('node-pty', () => {
  throw new Error('A service loaded node-pty.');
});

let home: TestHome;
beforeEach(() => {
  home = makeHome('hatstand-services-');
});
afterEach(() => home.remove());

describe('the services behind the API', () => {
  it('load and run without Electron or a terminal', async () => {
    const { ctx } = makeServiceContext(home);
    const services = createServices(ctx, fakeServiceDeps());
    const company = await services.createCompany('Acme', '#112233');
    expect((await services.getSnapshot()).companies.map((item) => item.id)).toEqual([company.id]);
  });

  it('give each method to one service only', () => {
    // Object.keys of the joined API can never repeat a name, so the check has to look at the services before they are joined.
    const { ctx } = makeServiceContext(home);
    const handledBy = new Map<string, string[]>();
    for (const [service, handlers] of Object.entries(serviceParts(ctx, fakeServiceDeps()))) {
      for (const method of Object.keys(handlers)) handledBy.set(method, [...(handledBy.get(method) ?? []), service]);
    }
    const handledTwice = [...handledBy].filter(([, services]) => services.length > 1);
    expect(handledTwice).toEqual([]);
  });

  it('leave the methods that need the desktop to the app, and lose none of their own when joined', () => {
    const { ctx } = makeServiceContext(home);
    const parts = serviceParts(ctx, fakeServiceDeps());
    const own = Object.values(parts).flatMap((handlers) => Object.keys(handlers));
    const desktop: readonly string[] = DESKTOP_METHODS;
    expect(own.filter((method) => desktop.includes(method))).toEqual([]);
    expect(new Set(DESKTOP_METHODS).size).toBe(DESKTOP_METHODS.length);
    expect(Object.keys(createServices(ctx, fakeServiceDeps())).sort()).toEqual([...own].sort());
  });

  it('refuse to wire a method twice, instead of one handler quietly replacing the other', () => {
    const first = { addIdeas: async () => {} };
    const second = { addIdeas: async () => {} };
    expect(() => combineHandlers(first, second)).toThrow('addIdeas is handled twice.');
    expect(Object.keys(combineHandlers(first, { guardStatus: async () => [] }))).toEqual(['addIdeas', 'guardStatus']);
  });
});

describe('the terminals of the interface', () => {
  it('send each call to the agent signing in when the terminal shows one, and to the task session otherwise', async () => {
    const deps = fakeServiceDeps();
    vi.mocked(deps.signIn.has).mockImplementation((id) => id === 'sign-in');
    const terminals = createSessionService(deps);

    await terminals.writeSession('sign-in', 'y');
    await terminals.resizeSession('sign-in', 80, 24);
    expect(deps.signIn.write).toHaveBeenCalledWith('sign-in', 'y');
    expect(deps.signIn.resize).toHaveBeenCalledWith('sign-in', 80, 24);
    expect(await terminals.readSessionOutput('sign-in')).toEqual({ text: 'sign in', end: 7 });
    expect(deps.sessions.write).not.toHaveBeenCalled();

    await terminals.writeSession('task', 'x');
    await terminals.resizeSession('task', 100, 30);
    expect(deps.sessions.write).toHaveBeenCalledWith('task', 'x');
    expect(deps.sessions.resize).toHaveBeenCalledWith('task', 100, 30);
    expect(await terminals.readSessionBuffer('task')).toBe('task session');
  });
});
