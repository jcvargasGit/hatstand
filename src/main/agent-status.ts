import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as pty from 'node-pty';
import { z } from 'zod';
import { AGENT_INFO } from '../shared/agents';
import type { AgentStatus, SessionOutput } from '../shared/api';
import type { Account } from '../shared/schemas';
import { buildAgentEnv } from './env';
import { findExecutable } from './shell';

const STATUS_TIMEOUT_MS = 15_000;

const authStatusSchema = z.object({
  loggedIn: z.boolean(),
  email: z.string().nullish(),
  subscriptionType: z.string().nullish(),
});

export function parseAuthStatus(output: string): Pick<AgentStatus, 'signedIn' | 'email' | 'plan'> {
  try {
    const status = authStatusSchema.parse(JSON.parse(output));
    return {
      signedIn: status.loggedIn,
      email: status.email ?? undefined,
      plan: status.subscriptionType ?? undefined,
    };
  } catch {
    return { signedIn: false };
  }
}

function accountEnv(account: Account, path: string): Record<string, string> {
  return buildAgentEnv({
    base: process.env,
    path,
    secrets: {},
    extra: account.configDir ? { [AGENT_INFO[account.type].configDirVariable]: account.configDir } : {},
  });
}

const copilotUserSchema = z.object({ login: z.string().optional() });
const copilotConfigSchema = z.object({
  loggedInUsers: z.array(copilotUserSchema).default([]),
  lastLoggedInUser: copilotUserSchema.optional(),
});

export function parseCopilotConfig(text: string): Pick<AgentStatus, 'signedIn' | 'email'> {
  try {
    const withoutComments = text.replace(/^\s*\/\/.*$/gm, '');
    const config = copilotConfigSchema.parse(JSON.parse(withoutComments));
    if (config.loggedInUsers.length === 0) return { signedIn: false };
    return { signedIn: true, email: config.lastLoggedInUser?.login ?? config.loggedInUsers[0]?.login };
  } catch {
    return { signedIn: false };
  }
}

function copilotSignIn(account: Account, home = homedir()): Pick<AgentStatus, 'signedIn' | 'email'> {
  try {
    return parseCopilotConfig(readFileSync(join(account.configDir ?? join(home, '.copilot'), 'config.json'), 'utf8'));
  } catch {
    return { signedIn: false };
  }
}

export function checkAgent(account: Account, path: string): Promise<AgentStatus> {
  const executable = findExecutable(AGENT_INFO[account.type].command, path);
  if (!executable) return Promise.resolve({ installed: false, signedIn: false });
  if (account.type === 'github-copilot') return Promise.resolve({ installed: true, ...copilotSignIn(account) });
  return new Promise((resolve) => {
    execFile(
      executable,
      ['auth', 'status', '--json'],
      { env: accountEnv(account, path), timeout: STATUS_TIMEOUT_MS },
      (_error, stdout) => resolve({ installed: true, ...parseAuthStatus(stdout) }),
    );
  });
}

export type SignInEvents = {
  onData(terminalId: string, data: string, end: number): void;
  onExit(): void;
};

export class AgentSignIn {
  private readonly live = new Map<string, { process: pty.IPty; buffer: string; emitted: number }>();

  constructor(
    private readonly path: string,
    private readonly events: SignInEvents,
  ) {}

  start(account: Account): string {
    const agent = AGENT_INFO[account.type];
    const executable = findExecutable(agent.command, this.path);
    if (!executable) throw new Error(`${agent.name} is not installed yet.`);
    const id = randomUUID();
    const child = pty.spawn(executable, agent.signInArgs, {
      name: 'xterm-256color',
      cols: 90,
      rows: 14,
      env: accountEnv(account, this.path),
    });
    const entry = { process: child, buffer: '', emitted: 0 };
    this.live.set(id, entry);
    child.onData((data) => {
      entry.buffer += data;
      entry.emitted += data.length;
      this.events.onData(id, data, entry.emitted);
    });
    child.onExit(() => {
      this.live.delete(id);
      this.events.onExit();
    });
    return id;
  }

  has(id: string): boolean {
    return this.live.has(id);
  }

  write(id: string, data: string): void {
    this.live.get(id)?.process.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    this.live.get(id)?.process.resize(cols, rows);
  }

  readBuffer(id: string): string {
    return this.readOutput(id).text;
  }

  readOutput(id: string): SessionOutput {
    const entry = this.live.get(id);
    return entry ? { text: entry.buffer, end: entry.emitted } : { text: '', end: 0 };
  }

  stopAll(): void {
    for (const entry of this.live.values()) entry.process.kill();
    this.live.clear();
  }
}
