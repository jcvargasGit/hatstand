import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDescriptionPrompt } from '../../src/main/agents/description-prompt';
import { BLOCKED_TOOLS, buildSuggestionLaunch, DescriptionSuggester, runWithExecFile, type SuggestionRunner } from '../../src/main/description-suggestion';
import { dataPaths, type DataPaths } from '../../src/main/paths';
import { Store } from '../../src/main/store';
import { parseSuggestionOutput, suggestionRequestSchema } from '../../src/shared/description-suggestion';
import { companySchema, type Account } from '../../src/shared/schemas';

const envelope = (result: string, isError = false) => JSON.stringify({ type: 'result', is_error: isError, result });
const claude: Account = { id: 'a', name: 'Claude', type: 'claude-code', label: 'company', model: 'opus', configDir: '/cfg/work' };

describe('reading the answer of the agent', () => {
  it('reads the description from the JSON result', () => {
    expect(parseSuggestionOutput(envelope('{"description": "# Task\\nDo it"}'))).toEqual({ ok: true, description: '# Task\nDo it' });
  });

  it('accepts the JSON inside a code fence or after some words', () => {
    expect(parseSuggestionOutput(envelope('```json\n{"description": "Fenced"}\n```'))).toEqual({ ok: true, description: 'Fenced' });
    expect(parseSuggestionOutput(envelope('Here it is: {"description": "Inline"}'))).toEqual({ ok: true, description: 'Inline' });
  });

  it('explains an error of the agent', () => {
    expect(parseSuggestionOutput(envelope('Not signed in', true))).toEqual({ ok: false, problem: 'The agent could not finish: Not signed in.' });
  });

  it('refuses text that is not usable', () => {
    expect(parseSuggestionOutput('not json').ok).toBe(false);
    expect(parseSuggestionOutput(envelope('I could not do it')).ok).toBe(false);
    expect(parseSuggestionOutput(envelope('{"description": "  "}'))).toEqual({ ok: false, problem: 'The agent returned an empty description.' });
  });

  it('needs a title or a description to ask for one', () => {
    expect(suggestionRequestSchema.safeParse({ key: 'k', companyId: 'c', title: ' ', description: '' }).success).toBe(false);
    expect(suggestionRequestSchema.safeParse({ key: 'k', companyId: 'c', title: 'Export' }).success).toBe(true);
  });
});

describe('the prompt for a better description', () => {
  const company = companySchema.parse({ id: 'acme', name: 'Acme', color: '#112233' });
  const base = { company, repositories: [{ id: 'api', name: 'api', path: '/code/api' }], knowledgeDir: '/k', companyInstructions: '', title: 'Export', description: 'CSV export of invoices' };

  it('carries the task, the folders and the read-only rule', () => {
    const prompt = buildDescriptionPrompt({ ...base, area: { id: 'b', name: 'Billing', description: 'Invoices', folders: [], links: [] }, areaFolder: '/areas/billing' });
    expect(prompt).toContain('Title: Export');
    expect(prompt).toContain('CSV export of invoices');
    expect(prompt).toContain('Repository api: /code/api');
    expect(prompt).toContain('Client knowledge: /k');
    expect(prompt).toContain('Area "Billing": Invoices. Its files are in /areas/billing');
    expect(prompt).toContain('Use only Read, Grep and Glob');
    expect(prompt).toContain('Do not create subtasks');
    expect(prompt).not.toContain('## Client instructions');
  });

  it('adds the client instructions so their task format is followed', () => {
    const prompt = buildDescriptionPrompt({ ...base, companyInstructions: '# Task format\nThree sections.' });
    expect(prompt).toContain('## Client instructions');
    expect(prompt).toContain('Three sections.');
  });
});

describe('launching the agent for a suggestion', () => {
  it('allows only reading tools, and uses the account', () => {
    const launch = buildSuggestionLaunch(claude, 'prompt', ['/k', '/code/api'], '/bin');
    expect(launch.args.slice(0, 4)).toEqual(['-p', 'prompt', '--output-format', 'json']);
    expect(launch.args[launch.args.indexOf('--allowedTools') + 1]).toBe('Read,Grep,Glob');
    expect(launch.args[launch.args.indexOf('--disallowedTools') + 1]?.split(',')).toEqual(expect.arrayContaining(['Bash', 'Edit', 'Write']));
    expect(launch.args).not.toContain('--dangerously-skip-permissions');
    expect(launch.args).toEqual(expect.arrayContaining(['--model', 'opus', '--add-dir', '/k', '--add-dir', '/code/api']));
    expect(launch.env.CLAUDE_CONFIG_DIR).toBe('/cfg/work');
    expect(BLOCKED_TOOLS).toContain('WebFetch');
  });

  it('refuses GitHub Copilot accounts for now', () => {
    expect(() => buildSuggestionLaunch({ ...claude, type: 'github-copilot' }, 'p', [], '/bin')).toThrow('Only Claude Code accounts');
  });
});

describe('the suggester', () => {
  let dir: string;
  let bin: string;
  let repo: string;
  let paths: DataPaths;
  let store: Store;

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-suggest-')));
    bin = join(dir, 'bin');
    repo = join(dir, 'code', 'api');
    mkdirSync(bin);
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(bin, 'claude'), '#!/bin/sh\n');
    chmodSync(join(bin, 'claude'), 0o755);
    paths = dataPaths(join(dir, 'home'));
    store = new Store(paths);
    store.saveCompany({ ...store.createCompany('Acme', '#112233'), projects: [{ id: 'api', name: 'api', path: repo }], skipPermissions: true });
    store.saveAccount(claude);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const request = { key: 'task-1', companyId: 'acme', title: 'Export', description: 'CSV', projectIds: ['api'] };

  it('runs the agent in the repository of the task and returns its description', async () => {
    const runner = vi.fn<SuggestionRunner>(async () => ({ stdout: envelope('{"description": "Better"}') }));
    const result = await new DescriptionSuggester(paths, store, bin, runner).suggest(request);
    expect(result).toEqual({ description: 'Better' });
    const [executable, launch, cwd] = runner.mock.calls[0] ?? [];
    expect(executable).toBe(join(bin, 'claude'));
    expect(cwd).toBe(repo);
    expect(launch?.args).toContain(repo);
    expect(launch?.args).not.toContain('--dangerously-skip-permissions');
  });

  it('says when the agent took too long', async () => {
    const runner: SuggestionRunner = async () => ({ stdout: '', failure: 'timeout' });
    await expect(new DescriptionSuggester(paths, store, bin, runner).suggest(request)).rejects.toThrow('more than 5 minutes');
  });

  it('shows the reason the agent gives when it fails', async () => {
    const runner: SuggestionRunner = async () => ({ stdout: envelope('Credit balance too low', true), failure: 'failed', detail: 'exit 1' });
    await expect(new DescriptionSuggester(paths, store, bin, runner).suggest(request)).rejects.toThrow('Credit balance too low');
  });

  it('cancels the earlier run when the same task asks again', async () => {
    const signals: AbortSignal[] = [];
    const runner: SuggestionRunner = (_executable, _launch, _cwd, signal) => {
      signals.push(signal);
      return new Promise((resolve) => {
        if (signals.length === 1) signal.addEventListener('abort', () => resolve({ stdout: '', failure: 'cancelled' }));
        else resolve({ stdout: envelope('{"description": "Second"}') });
      });
    };
    const suggester = new DescriptionSuggester(paths, store, bin, runner);
    const first = suggester.suggest(request);
    const second = suggester.suggest(request);
    await expect(first).rejects.toThrow('cancelled');
    await expect(second).resolves.toEqual({ description: 'Second' });
    expect(signals[0]?.aborted).toBe(true);
  });

  it('says when claude is not installed', async () => {
    await expect(new DescriptionSuggester(paths, store, join(dir, 'empty'), vi.fn()).suggest(request)).rejects.toThrow('claude was not found');
  });

  it('runs a real program and reads what it prints', async () => {
    const script = join(bin, 'claude');
    writeFileSync(script, `#!/bin/sh\nprintf '%s' '${envelope('{"description": "From the program"}')}'\n`);
    const result = await new DescriptionSuggester(paths, store, bin, runWithExecFile).suggest(request);
    expect(result).toEqual({ description: 'From the program' });
  });
});
