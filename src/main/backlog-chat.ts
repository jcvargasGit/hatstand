import { mkdirSync } from 'node:fs';
import { buildTaskContext, CHAT_TIMEOUT_MS, chatRequestSchema, MAX_CHAT_HISTORY, parseChatOutput, resolveRelated, type ChatAnswer } from '../shared/backlog-chat';
import type { Account } from '../shared/schemas';
import { execFileRunner, type AgentLaunch, type AgentRunner, type RunResult } from './agent-run';
import { buildBacklogChatPrompt } from './agents/backlog-chat-prompt';
import { BLOCKED_TOOLS, READ_TOOLS } from './description-suggestion';
import { buildAgentEnv } from './env';
import type { DataPaths } from './paths';
import { resolveAccount } from './sessions';
import { findExecutable } from './shell';
import type { Store } from './store';

/** Every tool that reads or changes something. The chat answers from its prompt alone. */
export const CHAT_BLOCKED_TOOLS = [...READ_TOOLS, ...BLOCKED_TOOLS];
const CANCELLED = 'The question was cancelled.';

/**
 * The agent gets the tasks in the prompt and nothing else: no built-in tool, no MCP server, no folder,
 * no key of the client, and none of the instruction or memory files it would load by itself.
 */
export function buildChatLaunch(account: Account, prompt: string, shellPath: string): AgentLaunch {
  if (account.type !== 'claude-code') throw new Error('Only Claude Code accounts can answer in the backlog chat for now.');
  return {
    args: [
      '-p',
      '--output-format',
      'json',
      '--tools',
      '',
      '--disallowedTools',
      CHAT_BLOCKED_TOOLS.join(','),
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--no-session-persistence',
      ...(account.model ? ['--model', account.model] : []),
    ],
    env: buildAgentEnv({
      base: process.env,
      path: shellPath,
      secrets: {},
      extra: {
        CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
        ...(account.configDir ? { CLAUDE_CONFIG_DIR: account.configDir } : {}),
      },
    }),
    input: prompt,
  };
}

function failureMessage(result: RunResult): string {
  if (result.failure === 'cancelled') return CANCELLED;
  if (result.failure === 'timeout') return `The agent took more than ${CHAT_TIMEOUT_MS / 60_000} minutes. Try again, or ask a shorter question.`;
  const detail = result.detail?.replace(/\.$/, '');
  return `The agent stopped with an error${detail ? `: ${detail}` : ''}. Check that it is signed in, then try again.`;
}

export class BacklogChat {
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly paths: DataPaths,
    private readonly store: Store,
    private readonly shellPath: string,
    private readonly runner: AgentRunner = execFileRunner(CHAT_TIMEOUT_MS),
  ) {}

  async ask(raw: unknown): Promise<ChatAnswer> {
    const request = chatRequestSchema.parse(raw);
    const company = this.store.readCompany(request.companyId);
    const accounts = this.store.readAccounts();
    const account = resolveAccount(accounts.accounts, accounts.defaultAccountId, company, {});
    const tasks = this.store.listTasks(company.id);
    const prompt = buildBacklogChatPrompt({
      company,
      context: buildTaskContext(tasks),
      history: request.history.slice(-MAX_CHAT_HISTORY),
      question: request.question,
    });
    const launch = buildChatLaunch(account, prompt, this.shellPath);
    const executable = findExecutable('claude', this.shellPath);
    if (!executable) throw new Error('claude was not found on your PATH. Install it and sign in, then try again.');
    mkdirSync(this.paths.chatDir, { recursive: true });

    this.cancel(request.key);
    const controller = new AbortController();
    this.running.set(request.key, controller);
    try {
      const result = await this.runner(executable, launch, this.paths.chatDir, controller.signal);
      if (result.failure === 'cancelled' || controller.signal.aborted) throw new Error(CANCELLED);
      const parsed = parseChatOutput(result.stdout);
      if (parsed.ok) return { answer: parsed.reply.answer, related: resolveRelated(parsed.reply.related, tasks) };
      const explainsItself = result.failure !== 'timeout' && result.stdout.trim() !== '';
      throw new Error(result.failure && !explainsItself ? failureMessage(result) : parsed.problem);
    } finally {
      if (this.running.get(request.key) === controller) this.running.delete(request.key);
    }
  }

  cancel(key: string): void {
    this.running.get(key)?.abort();
    this.running.delete(key);
  }

  stopAll(): void {
    for (const key of this.running.keys()) this.cancel(key);
  }
}
