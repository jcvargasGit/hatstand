import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { SESSION_RESTART_LINE } from '../../src/main/agents/subagent-activity';
import { requireSession, SessionStates, type TrackedSession } from '../../src/main/session-state';
import { writePrivateFile } from '../../src/main/store';
import type { Session } from '../../src/shared/schemas';
import { makeHome, type TestHome } from '../helpers/home';

let home: TestHome;
let session: Session;
let running: TrackedSession | undefined;
let onChange: Mock<() => void>;
let onNeedsInput: Mock<(session: Session) => void>;
let states: SessionStates;

beforeEach(() => {
  home = makeHome('hatstand-session-state-');
  home.store.createCompany('Acme', '#112233');
  const task = home.store.createTask({ companyId: 'acme', title: 'Fix it' });
  const now = new Date().toISOString();
  session = { id: randomUUID(), taskId: task.id, companyId: 'acme', accountId: 'a', cwd: home.root, state: 'working', startedAt: now, updatedAt: now };
  home.store.saveSession(session);
  running = { startedAt: 0, turnCheck: null, state: 'working' };
  onChange = vi.fn<() => void>();
  onNeedsInput = vi.fn<(session: Session) => void>();
  states = new SessionStates(home.paths, home.store, { onChange, onNeedsInput }, (id) => (id === session.id ? running : undefined));
});
afterEach(() => home.remove());

const saved = () => requireSession(home.store, session.id);
const agentReports = (text: string) => writePrivateFile(home.paths.statusFile(session.id), text);

describe('what the agent reports', () => {
  it('waits for the agent to report something', () => {
    states.poll(session.id);
    expect(saved().state).toBe('working');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('records a new state once, on the session and on the running terminal', () => {
    agentReports('idle\n');
    states.poll(session.id);
    states.poll(session.id);
    expect(saved().state).toBe('idle');
    expect(running?.state).toBe('idle');
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('reads no session while the report stays the same', () => {
    const allSessions = vi.spyOn(home.store, 'listSessions');
    const oneSession = vi.spyOn(home.store, 'readSession');
    agentReports('working');
    states.poll(session.id);
    states.poll(session.id);
    expect(allSessions).not.toHaveBeenCalled();
    expect(oneSession).not.toHaveBeenCalled();
    agentReports('idle');
    states.poll(session.id);
    expect(allSessions).not.toHaveBeenCalled();
    expect(oneSession).toHaveBeenCalledExactlyOnceWith(session.id);
  });

  it('calls the person when the agent waits at its prompt, and keeps the report as idle', () => {
    agentReports('waiting');
    states.poll(session.id);
    expect(readFileSync(home.paths.statusFile(session.id), 'utf8')).toBe('idle');
    expect(saved().state).toBe('idle');
    expect(onNeedsInput).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: session.id, state: 'idle' }));
  });

  it('calls the person when the agent asks a question', () => {
    agentReports('needs-input');
    states.poll(session.id);
    expect(onNeedsInput).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: session.id, state: 'needs-input' }));
  });

  it('ignores what it does not know', () => {
    agentReports('thinking hard');
    states.poll(session.id);
    expect(saved().state).toBe('working');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('updates the status of the task once the agent stops working', () => {
    const applied = vi.spyOn(home.store, 'applyAgentStatus');
    states.set(session.id, 'needs-input');
    expect(applied).not.toHaveBeenCalled();
    states.set(session.id, 'stopped');
    expect(applied).toHaveBeenCalledExactlyOnceWith(session.taskId);
  });

  it('still records the state of a session that has ended', () => {
    running = undefined;
    states.set(session.id, 'stopped');
    expect(saved().state).toBe('stopped');
  });

  it('fails for a session that no longer exists', () => {
    expect(() => states.set('gone', 'idle')).toThrow('Session gone no longer exists.');
  });
});

describe('a turn that is still going', () => {
  const transcriptOf = (...entries: unknown[]) => {
    const file = join(home.root, 'transcript.jsonl');
    writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join('\n'));
    writePrivateFile(home.paths.activityFile(session.id), `${JSON.stringify({ hook_event_name: 'SessionStart', transcript_path: file })}\n`);
  };
  const toolStillRunning = () =>
    transcriptOf(
      { type: 'user', timestamp: new Date().toISOString(), message: { content: 'Do it' } },
      { type: 'assistant', timestamp: new Date().toISOString(), message: { content: [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }] } },
    );

  it('keeps the agent working while its transcript shows a tool running, and does not call the person', () => {
    toolStillRunning();
    agentReports('waiting');
    states.poll(session.id);
    expect(saved().state).toBe('working');
    expect(onNeedsInput).not.toHaveBeenCalled();
    expect(running?.turnCheck?.progress).toMatchObject({ turnOpen: true, toolRunning: true });
  });

  it('believes the agent once its session has ended', () => {
    toolStillRunning();
    running = undefined;
    agentReports('idle');
    states.poll(session.id);
    expect(saved().state).toBe('idle');
  });
});

describe('the person answering the agent', () => {
  it('marks a question as answered, so the agent is seen working again', () => {
    agentReports('needs-input');
    states.markAnswered(session.id);
    expect(readFileSync(home.paths.statusFile(session.id), 'utf8')).toBe('working');
  });

  it('leaves any other report alone', () => {
    agentReports('idle');
    states.markAnswered(session.id);
    expect(readFileSync(home.paths.statusFile(session.id), 'utf8')).toBe('idle');
  });

  it('only counts the agent at its prompt when it is idle or working in the background, reading its latest report first', () => {
    agentReports('needs-input');
    expect(states.isAtItsPrompt(session.id)).toBe(false);
    agentReports('idle');
    expect(states.isAtItsPrompt(session.id)).toBe(true);
    running = undefined;
    expect(states.isAtItsPrompt(session.id)).toBe(false);
  });
});

describe('preparing a session to report', () => {
  it('starts the status at the state of the session, with an empty activity, and tells the agent where both are', () => {
    expect(states.prepareSession(session)).toEqual({ env: { HATSTAND_STATUS_FILE: home.paths.statusFile(session.id), HATSTAND_ACTIVITY_FILE: home.paths.activityFile(session.id) } });
    expect(readFileSync(home.paths.statusFile(session.id), 'utf8')).toBe('working');
    expect(readFileSync(home.paths.activityFile(session.id), 'utf8')).toBe('');
  });

  it('keeps the activity of a resumed session, marked where it started again', () => {
    writePrivateFile(home.paths.activityFile(session.id), 'before\n');
    states.prepareSession({ ...session, state: 'idle' });
    expect(readFileSync(home.paths.activityFile(session.id), 'utf8')).toBe(`before\n${SESSION_RESTART_LINE}`);
    expect(readFileSync(home.paths.statusFile(session.id), 'utf8')).toBe('idle');
  });
});
