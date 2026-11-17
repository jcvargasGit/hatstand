import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionManager } from '../../src/main/sessions';
import type { Session } from '../../src/shared/schemas';
import { makeHome, type TestHome } from '../helpers/home';
import { fakeAgentBin, fakeProtection, noSecrets } from '../helpers/sessions';

vi.mock('node-pty', () => ({
  spawn: () => ({ write: () => {}, onData: () => {}, onExit: () => {}, kill: () => {}, resize: () => {} }),
}));

let home: TestHome;
let sessions: SessionManager;
let session: Session;

beforeEach(async () => {
  vi.useFakeTimers();
  home = makeHome('hatstand-polling-cost-');
  home.store.saveCompany({ ...home.store.createCompany('Acme', '#112233'), rootDir: home.root });
  sessions = new SessionManager(home.paths, home.store, noSecrets, fakeAgentBin(home.root), { onData: () => {}, onChange: () => {}, onNeedsInput: () => {} }, fakeProtection());
  session = await sessions.start(home.store.createTask({ companyId: 'acme', title: 'Fix it' }).id);
});

afterEach(() => {
  sessions.stopAll();
  vi.useRealTimers();
  home.remove();
});

const saved = () => home.store.readSession(session.id);

describe('polling a running session', () => {
  it('reads no session while the agent reports nothing new, and still records the next state within a second', () => {
    const allSessions = vi.spyOn(home.store, 'listSessions');
    const oneSession = vi.spyOn(home.store, 'readSession');
    vi.advanceTimersByTime(5000);
    expect(allSessions).toHaveBeenCalledTimes(0);
    expect(oneSession).toHaveBeenCalledTimes(0);

    writeFileSync(home.paths.statusFile(session.id), 'working');
    vi.advanceTimersByTime(1000);
    expect(allSessions).toHaveBeenCalledTimes(0);
    oneSession.mockRestore();
    expect(saved()?.state).toBe('working');
  });

  it('does not read every session when the agent reports a step done', () => {
    const allSessions = vi.spyOn(home.store, 'listSessions');
    writeFileSync(home.paths.stepFile(session.id), '1\n');
    vi.advanceTimersByTime(1000);
    expect(allSessions).toHaveBeenCalledTimes(0);
  });

  it('keeps recording each change after a quiet time', () => {
    for (const state of ['working', 'needs-input', 'working', 'idle'] as const) {
      vi.advanceTimersByTime(3000);
      writeFileSync(home.paths.statusFile(session.id), state);
      vi.advanceTimersByTime(1000);
      expect(saved()?.state).toBe(state);
    }
  });
});
