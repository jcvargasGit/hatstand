import type { Account, Company, SessionState, Task } from '../../shared/schemas';

export type AgentLaunchInput = {
  account: Account;
  company: Company;
  task: Task;
  sessionId: string;
  sessionDir: string;
  notesFile: string;
  resume: boolean;
  promptFile: string;
  settingsFile: string;
  addDirs: string[];
};

export type AgentLaunch = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

export type AgentSessionFiles = {
  sessionDir: string;
  promptFile: string;
  settingsFile: string;
};

export type AgentAdapter = {
  hiddenSecrets?: string[];
  buildLaunch(input: AgentLaunchInput): AgentLaunch;
  buildStatusSettings(): string;
  prepareSession?(files: AgentSessionFiles): void;
};

export const STATUS_FILE_ENV = 'HATSTAND_STATUS_FILE';
export const ACTIVITY_FILE_ENV = 'HATSTAND_ACTIVITY_FILE';
export const WAITING_AT_PROMPT = 'waiting';

export const reportedStates: readonly SessionState[] = ['working', 'needs-input', 'idle'];
