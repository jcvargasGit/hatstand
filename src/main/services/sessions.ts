import type { HatstandApi } from '../../shared/api';
import type { AgentSignIn } from '../agent-status';
import type { SessionManager } from '../sessions';

export type SessionService = Pick<
  HatstandApi,
  | 'startSession'
  | 'resumeSession'
  | 'stopSession'
  | 'writeSession'
  | 'sendDraft'
  | 'resizeSession'
  | 'readSessionBuffer'
  | 'readSessionOutput'
  | 'readSubagents'
  | 'refreshTaskSummary'
>;

export type SessionServiceDeps = {
  sessions: Pick<SessionManager, 'start' | 'resume' | 'stop' | 'write' | 'sendDraft' | 'resize' | 'readBuffer' | 'readOutput' | 'readSubagents' | 'refreshSummary'>;
  signIn: Pick<AgentSignIn, 'has' | 'write' | 'resize' | 'readBuffer' | 'readOutput'>;
};

/** The terminals of the interface. A terminal shows either a task session or an agent signing in, and each call goes to the one it shows. */
export function createSessionService({ sessions, signIn }: SessionServiceDeps): SessionService {
  return {
    startSession: async (taskId) => sessions.start(taskId),
    resumeSession: async (sessionId) => sessions.resume(sessionId),
    stopSession: async (sessionId) => sessions.stop(sessionId),
    writeSession: async (sessionId, data) =>
      signIn.has(sessionId) ? signIn.write(sessionId, data) : sessions.write(sessionId, data),
    sendDraft: async (sessionId) => sessions.sendDraft(sessionId),
    resizeSession: async (sessionId, cols, rows) =>
      signIn.has(sessionId) ? signIn.resize(sessionId, cols, rows) : sessions.resize(sessionId, cols, rows),
    readSessionBuffer: async (sessionId) =>
      signIn.has(sessionId) ? signIn.readBuffer(sessionId) : sessions.readBuffer(sessionId),
    readSessionOutput: async (sessionId) => (signIn.has(sessionId) ? signIn.readOutput(sessionId) : sessions.readOutput(sessionId)),
    readSubagents: async (sessionId) => sessions.readSubagents(sessionId),
    refreshTaskSummary: async (taskId) => sessions.refreshSummary(taskId),
  };
}
