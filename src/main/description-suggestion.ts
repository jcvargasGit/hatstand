import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { parseSuggestionOutput, SUGGESTION_TIMEOUT_MS, suggestionRequestSchema, type DescriptionSuggestion } from '../shared/description-suggestion';
import { areaFolder as areaFolderName } from '../shared/areas';
import type { Account } from '../shared/schemas';
import { activeKnowledgeDir } from './active-folders';
import { buildDescriptionPrompt } from './agents/description-prompt';
import { buildAgentEnv } from './env';
import type { DataPaths } from './paths';
import { resolveAccount } from './sessions';
import { findExecutable } from './shell';
import { readClientInstructions } from './starter-files';
import type { Store } from './store';
import { taskArea, taskRepositories } from './task-folders';

export const READ_TOOLS = ['Read', 'Grep', 'Glob'];
export const BLOCKED_TOOLS = ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task'];
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const CANCELLED = 'The suggestion was cancelled.';

export type SuggestionLaunch = { args: string[]; env: Record<string, string> };
export type RunResult = { stdout: string; failure?: 'timeout' | 'cancelled' | 'failed'; detail?: string };
export type SuggestionRunner = (executable: string, launch: SuggestionLaunch, cwd: string, signal: AbortSignal) => Promise<RunResult>;

export function buildSuggestionLaunch(account: Account, prompt: string, addDirs: string[], shellPath: string): SuggestionLaunch {
  if (account.type !== 'claude-code') throw new Error('Only Claude Code accounts can improve descriptions for now.');
  return {
    args: [
      '-p',
      prompt,
      '--output-format',
      'json',
      '--allowedTools',
      READ_TOOLS.join(','),
      '--disallowedTools',
      BLOCKED_TOOLS.join(','),
      ...(account.model ? ['--model', account.model] : []),
      ...addDirs.flatMap((dir) => ['--add-dir', dir]),
    ],
    env: buildAgentEnv({
      base: process.env,
      path: shellPath,
      secrets: {},
      extra: account.configDir ? { CLAUDE_CONFIG_DIR: account.configDir } : {},
    }),
  };
}

export const runWithExecFile: SuggestionRunner = (executable, launch, cwd, signal) =>
  new Promise((resolve) => {
    execFile(executable, launch.args, { cwd, env: launch.env, signal, timeout: SUGGESTION_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES }, (error, stdout, stderr) => {
      if (!error) return resolve({ stdout });
      if (signal.aborted) return resolve({ stdout, failure: 'cancelled' });
      if ('killed' in error && error.killed) return resolve({ stdout, failure: 'timeout' });
      resolve({ stdout, failure: 'failed', detail: stderr.trim() || error.message });
    });
  });

function failureMessage(result: RunResult): string {
  if (result.failure === 'cancelled') return CANCELLED;
  if (result.failure === 'timeout') return `The agent took more than ${SUGGESTION_TIMEOUT_MS / 60_000} minutes. Try again, or shorten the description.`;
  return `The agent stopped with an error${result.detail ? `: ${result.detail}` : '.'} Check that it is signed in, then try again.`;
}

export class DescriptionSuggester {
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly paths: DataPaths,
    private readonly store: Store,
    private readonly shellPath: string,
    private readonly runner: SuggestionRunner = runWithExecFile,
  ) {}

  async suggest(raw: unknown): Promise<DescriptionSuggestion> {
    const request = suggestionRequestSchema.parse(raw);
    const company = this.store.readCompany(request.companyId);
    const accounts = this.store.readAccounts();
    const account = resolveAccount(accounts.accounts, accounts.defaultAccountId, company, request);
    const area = taskArea(company, request);
    const areaFolder = area ? this.paths.areaDir(company.id, areaFolderName(area)) : undefined;
    const repositories = taskRepositories(company, request).filter((repo) => existsSync(repo.path));
    const knowledgeDir = activeKnowledgeDir(this.paths, company);
    const prompt = buildDescriptionPrompt({
      company,
      area,
      areaFolder,
      repositories,
      knowledgeDir,
      companyInstructions: readClientInstructions(company),
      title: request.title,
      description: request.description,
    });
    const folders = [knowledgeDir, ...(areaFolder ? [areaFolder] : []), ...repositories.map((repo) => repo.path)].filter((dir) => existsSync(dir));
    const launch = buildSuggestionLaunch(account, prompt, folders, this.shellPath);
    const executable = findExecutable('claude', this.shellPath);
    if (!executable) throw new Error('claude was not found on your PATH. Install it and sign in, then try again.');
    const cwd = repositories[0]?.path ?? folders[0] ?? this.paths.home;

    this.cancel(request.key);
    const controller = new AbortController();
    this.running.set(request.key, controller);
    try {
      const result = await this.runner(executable, launch, cwd, controller.signal);
      if (result.failure === 'cancelled' || controller.signal.aborted) throw new Error(CANCELLED);
      const parsed = parseSuggestionOutput(result.stdout);
      if (parsed.ok) return { description: parsed.description };
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
