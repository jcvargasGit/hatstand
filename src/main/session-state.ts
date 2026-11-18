// What state a session is in: the agent reports it through its hooks into a status file, and the transcript
// tells a finished turn apart from one still running in the background.
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import type { Session, SessionState } from '../shared/schemas';
import { readAgentProgress, readTranscriptTail, sessionStateFrom, transcriptPathFrom, type AgentProgress } from './agents/agent-progress';
import { SESSION_RESTART_LINE } from './agents/subagent-activity';
import { ACTIVITY_FILE_ENV, reportedStates, STATUS_FILE_ENV, WAITING_AT_PROMPT } from './agents/types';
import type { DataPaths } from './paths';
import { writePrivateFile, type Store } from './store';

const TRANSCRIPT_RECHECK_MS = 15_000;
const TRANSCRIPT_MIN_READ_MS = 2_000;

export type TurnCheck = { modifiedAt: number; checkedAt: number; progress: AgentProgress };

/** The part of a running session that this module reads and keeps up to date. */
export type TrackedSession = { startedAt: number; turnCheck: TurnCheck | null; state: SessionState };

export type StateEvents = {
  onChange(): void;
  onNeedsInput(session: Session): void;
  /** Every saved change of state, with the state before it. */
  onStateChange?(session: Session, previous: SessionState): void;
};

/** Reads the one file of the session. Polling calls this, so it never reads every session. */
export function requireSession(store: Pick<Store, 'readSession'>, sessionId: string): Session {
  const session = store.readSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} no longer exists.`);
  return session;
}

export class SessionStates {
  constructor(
    private readonly paths: DataPaths,
    private readonly store: Store,
    private readonly events: StateEvents,
    /** The running session with this id, or undefined once it ended. */
    private readonly running: (sessionId: string) => TrackedSession | undefined,
  ) {}

  /**
   * Prepares the files the agent of a session reports through: its state, and its activity, such as its
   * subagents. A resumed session keeps its activity, marked where it started again.
   */
  prepareSession(session: Pick<Session, 'id' | 'state'>): { env: Record<string, string> } {
    const statusFile = this.paths.statusFile(session.id);
    const activityFile = this.paths.activityFile(session.id);
    writePrivateFile(statusFile, session.state);
    if (existsSync(activityFile)) appendFileSync(activityFile, SESSION_RESTART_LINE);
    else writePrivateFile(activityFile, '');
    return { env: { [STATUS_FILE_ENV]: statusFile, [ACTIVITY_FILE_ENV]: activityFile } };
  }

  /** Reads what the agent last reported, and records it. */
  poll(sessionId: string): void {
    const file = this.paths.statusFile(sessionId);
    if (!existsSync(file)) return;
    const reported = readFileSync(file, 'utf8').trim();
    if (reported === WAITING_AT_PROMPT) {
      writePrivateFile(file, 'idle');
      const state = this.fromAgent(sessionId, 'idle');
      this.set(sessionId, state);
      if (state === 'idle') this.events.onNeedsInput(requireSession(this.store, sessionId));
      return;
    }
    const state = reportedStates.find((item) => item === reported);
    if (state) this.set(sessionId, this.fromAgent(sessionId, state));
  }

  /** Enter would answer a question the agent asks, such as a permission, so the opening prompt is only sent while the agent waits at its prompt. */
  isAtItsPrompt(sessionId: string): boolean {
    this.poll(sessionId);
    const state = this.running(sessionId)?.state;
    return state === 'idle' || state === 'background';
  }

  set(sessionId: string, state: SessionState): void {
    const running = this.running(sessionId);
    // Every state of a running session is saved through here, so the one in memory is the saved one and an unchanged report reads no file.
    if (running?.state === state) return;
    if (running) running.state = state;
    const session = requireSession(this.store, sessionId);
    if (session.state === state) return;
    const updated = { ...session, state, updatedAt: new Date().toISOString() };
    this.store.saveSession(updated);
    this.events.onStateChange?.(updated, session.state);
    if (state === 'idle' || state === 'background' || state === 'stopped') this.store.applyAgentStatus(session.taskId);
    this.events.onChange();
    if (state === 'needs-input') this.events.onNeedsInput(updated);
  }

  /** The person answered the question the agent asked. Recorded before the agent can read the answer, so a quick reply from the agent is not overwritten. */
  markAnswered(sessionId: string): void {
    const file = this.paths.statusFile(sessionId);
    if (existsSync(file) && readFileSync(file, 'utf8').trim() === 'needs-input') writePrivateFile(file, 'working');
  }

  private fromAgent(sessionId: string, reported: SessionState): SessionState {
    const running = this.running(sessionId);
    const activityFile = this.paths.activityFile(sessionId);
    if (!running || reported === 'needs-input' || !existsSync(activityFile)) return reported;
    try {
      const transcript = transcriptPathFrom(readFileSync(activityFile, 'utf8'));
      if (!transcript || !existsSync(transcript)) return reported;
      const modifiedAt = statSync(transcript).mtimeMs;
      const now = Date.now();
      const check = running.turnCheck;
      const elapsed = check ? now - check.checkedAt : Infinity;
      const isCurrent = check && (check.modifiedAt === modifiedAt ? elapsed < TRANSCRIPT_RECHECK_MS : elapsed < TRANSCRIPT_MIN_READ_MS);
      const progress = isCurrent ? check.progress : readAgentProgress(readTranscriptTail(transcript), running.startedAt, now);
      if (!isCurrent) running.turnCheck = { modifiedAt, checkedAt: now, progress };
      return sessionStateFrom(reported, progress, now - modifiedAt);
    } catch {
      return reported;
    }
  }
}
