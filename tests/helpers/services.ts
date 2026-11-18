// A ServiceContext for the services in src/main/services, built without Electron.
import { vi } from 'vitest';
import type { HatstandEvents } from '../../src/shared/api';
import type { ServiceContext, ServiceDeps } from '../../src/main/services';
import type { CodeCopies } from '../../src/main/services/code-copies';
import type { TestHome } from './home';

export type Emitted = { event: keyof HatstandEvents; payload: unknown };

/** Secrets kept in memory, instead of sealed with the system keychain. */
export function memorySecrets(initial: Record<string, Record<string, string>> = {}): ServiceContext['secrets'] {
  const byClient = new Map(Object.entries(initial).map(([companyId, values]) => [companyId, { ...values }]));
  return {
    read: (companyId) => ({ ...byClient.get(companyId) }),
    names: (companyId) => Object.keys(byClient.get(companyId) ?? {}).sort(),
    merge: (companyId, values) => {
      byClient.set(companyId, { ...byClient.get(companyId), ...values });
    },
    remove: (companyId, name) => {
      const { [name]: _removed, ...rest } = byClient.get(companyId) ?? {};
      byClient.set(companyId, rest);
    },
  };
}

/** Stands in for the network. A service test that reaches it by mistake fails, instead of calling GitHub. */
export const noNetwork: typeof fetch = async (input) => {
  throw new Error(`A test tried to reach ${String(input)}.`);
};

/** A fake response, as fetch gives it. */
export const reply = (status: number, body: unknown = {}): Response =>
  new Response(body instanceof Uint8Array ? new Blob([new Uint8Array(body)]) : typeof body === 'string' ? body : JSON.stringify(body), { status });

/**
 * A context on a throwaway Hatstand folder, with a throwaway home folder next to it, and no network.
 * Every event a service sends is recorded.
 */
export function makeServiceContext(home: TestHome, secrets = memorySecrets(), fetch: typeof globalThis.fetch = noNetwork) {
  const emitted: Emitted[] = [];
  const ctx: ServiceContext = {
    store: home.store,
    paths: home.paths,
    secrets,
    tools: { path: process.env.PATH ?? '', nodePath: process.execPath },
    emit: (event, payload) => {
      emitted.push({ event, payload });
    },
    userHome: home.folder('user'),
    fetch,
  };
  /** How many times the interface was told to read the state again. */
  const stateChanges = () => emitted.filter((item) => item.event === 'state-changed').length;
  return { ctx, emitted, stateChanges };
}

/**
 * Fakes for what the services use from sessions, reviews, agents and the computer. Each one is a vi.fn that
 * does nothing; a test passes the ones it cares about.
 */
export function fakeServiceDeps(overrides: Partial<ServiceDeps> = {}): ServiceDeps {
  return {
    protection: { clearControlRepoHooks: vi.fn(() => []), refreshFingerprints: vi.fn(), refreshAllFingerprints: vi.fn() },
    sessions: {
      start: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      write: vi.fn(),
      sendDraft: vi.fn(),
      resize: vi.fn(),
      readBuffer: vi.fn(() => 'task session'),
      readOutput: vi.fn(() => ({ text: 'task session', end: 12 })),
      readSubagents: vi.fn(() => []),
      refreshSummary: vi.fn(async () => {}),
      sendPrompt: vi.fn(async () => {}),
      changeGuide: vi.fn(),
      moveGuideStep: vi.fn(),
      hasLiveSession: vi.fn(() => false),
      hasLiveClientSession: vi.fn(() => false),
      outsideChangesSettled: vi.fn(async () => {}),
    },
    signIn: {
      start: vi.fn(() => 'sign-in'),
      has: vi.fn(() => false),
      write: vi.fn(),
      resize: vi.fn(),
      readBuffer: vi.fn(() => 'sign in'),
      readOutput: vi.fn(() => ({ text: 'sign in', end: 7 })),
    },
    checkAgent: vi.fn(async () => ({ installed: true, signedIn: true })),
    reviews: { all: vi.fn(() => ({})), check: vi.fn(async () => {}), checkAll: vi.fn(async () => {}), get: vi.fn(() => undefined), failureLogs: vi.fn(async () => new Map<string, string>()) },
    suggester: { suggest: vi.fn(), cancel: vi.fn(), instructionsFor: vi.fn() },
    stayAwake: { active: false },
    applyStayAwake: vi.fn(),
    windows: { open: vi.fn(), close: vi.fn() },
    installedApp: { platform: 'linux', isPackaged: false, appRoot: '/app' },
    ...overrides,
  };
}

/** Copies of the code that remove nothing, unless a test passes what removing does. */
export const fakeCopies = (removeCopies: CodeCopies['removeCopies'] = vi.fn(async () => ({ removed: [], kept: [] }))): CodeCopies => ({ removeCopies });
