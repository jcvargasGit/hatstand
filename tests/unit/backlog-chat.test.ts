import { chmodSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunner } from '../../src/main/agent-run';
import { buildBacklogChatPrompt } from '../../src/main/agents/backlog-chat-prompt';
import { BacklogChat, buildChatLaunch, CHAT_BLOCKED_TOOLS } from '../../src/main/backlog-chat';
import { createServices } from '../../src/main/services';
import { buildTaskContext, chatRequestSchema, DESCRIPTION_CUT, MAX_CHAT_HISTORY, MAX_CHAT_QUESTION, parseChatOutput, resolveRelated } from '../../src/shared/backlog-chat';
import { taskSchema, type Account, type Task } from '../../src/shared/schemas';
import { makeHome, type TestHome } from '../helpers/home';
import { fakeServiceDeps, makeServiceContext } from '../helpers/services';

const envelope = (result: string, isError = false) => JSON.stringify({ type: 'result', is_error: isError, result });
const reply = (answer: string, related: (string | number)[] = []) => envelope(JSON.stringify({ answer, related }));
const claude: Account = { id: 'a', name: 'Claude', type: 'claude-code', label: 'company', model: 'opus', configDir: '/cfg/work' };

let created = 0;
const task = (fields: Partial<Task> & Pick<Task, 'title' | 'status'>): Task => {
  created += 1;
  return taskSchema.parse({ id: `id-${created}`, number: created, companyId: 'acme', createdAt: '2026-01-01', updatedAt: '2026-01-01', ...fields });
};

describe('the tasks the agent reads', () => {
  const tasks = [
    task({ title: 'Export invoices', status: 'done', doneAt: '2026-03-04T10:00:00Z', description: 'CSV export' }),
    task({ title: 'Login page', status: 'idea', priority: 'high', checklist: [{ id: 'c', text: 'Reproduce the error', done: false }] }),
    task({ title: 'Dark mode', status: 'doing' }),
    task({ title: 'Billing emails', status: 'todo' }),
    task({ title: 'Old importer', status: 'done', doneAt: '2025-01-01T10:00:00Z', archivedAt: '2025-02-01T10:00:00Z' }),
  ];
  const [exported, login, dark, billing, importer] = tasks.map((item) => `#${item.number}`);

  it('lists backlog, to do, in-progress and done tasks, each with its status', () => {
    const { text } = buildTaskContext(tasks);
    expect(text).toContain(`### ${login} Login page\nStatus: backlog, priority high\nChecklist: Reproduce the error`);
    expect(text).toContain(`### ${billing} Billing emails\nStatus: to do`);
    expect(text).toContain(`### ${dark} Dark mode\nStatus: in progress`);
    expect(text).toContain(`### ${exported} Export invoices\nStatus: done, finished on 2026-03-04\n> CSV export`);
    expect(text).toContain(`### ${importer} Old importer\nStatus: done, archived, finished on 2025-01-01`);
  });

  it('puts work in progress first and finished work last, newest first', () => {
    const { text } = buildTaskContext(tasks);
    const order = ['Dark mode', 'Billing emails', 'Login page', 'Export invoices', 'Old importer'].map((title) => text.indexOf(title));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order).not.toContain(-1);
  });

  it('names a task with no number by its id', () => {
    const unnumbered = { ...task({ title: 'Imported', status: 'todo' }), number: undefined };
    expect(buildTaskContext([unnumbered]).text).toContain(`### ${unnumbered.id} Imported`);
  });

  it('cuts a long description and keeps the title and the checklist whole', () => {
    const long = task({ title: 'Long one', status: 'todo', description: `Start ${'x'.repeat(DESCRIPTION_CUT * 2)} END`, checklist: [{ id: 'c', text: 'Whole item', done: true }] });
    const { text, withoutDescription } = buildTaskContext([long]);
    expect(text).toContain('> Start xxx');
    expect(text).toContain('…');
    expect(text).not.toContain('END');
    expect(text).toContain('Checklist: Whole item');
    expect(withoutDescription).toBe(0);
  });

  it('drops descriptions of the oldest finished tasks first when the list is too long', () => {
    const many = [
      task({ title: 'Old done', status: 'done', doneAt: '2024-01-01', description: 'old words '.repeat(20) }),
      task({ title: 'New done', status: 'done', doneAt: '2026-06-01', description: 'new words '.repeat(20) }),
      task({ title: 'Running', status: 'doing', description: 'running words '.repeat(20) }),
    ];
    const full = buildTaskContext(many);
    expect(full.withoutDescription).toBe(0);
    const tight = buildTaskContext(many, full.text.length - 1);
    expect(tight.withoutDescription).toBe(1);
    expect(tight.text).not.toContain('old words');
    expect(tight.text).toContain('new words');
    expect(tight.text).toContain('running words');
    expect(tight.text).toContain('Old done');
    expect(buildTaskContext(many, 1).withoutDescription).toBe(3);
  });

  it('says so when the client has no tasks', () => {
    expect(buildTaskContext([]).text).toContain('no tasks yet');
  });
});

describe('the question and the answer', () => {
  it('needs a question, up to a limit', () => {
    const request = { key: 'k', companyId: 'acme' };
    expect(chatRequestSchema.safeParse({ ...request, question: '  ' }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...request, question: 'x'.repeat(MAX_CHAT_QUESTION + 1) }).success).toBe(false);
    expect(chatRequestSchema.parse({ ...request, question: ' Export? ' })).toMatchObject({ question: 'Export?', history: [] });
  });

  it('reads the answer and the references, also inside a code fence', () => {
    expect(parseChatOutput(reply('Already done.', ['#3', 7]))).toEqual({ ok: true, reply: { answer: 'Already done.', related: ['#3', '7'] } });
    expect(parseChatOutput(envelope('```json\n{"answer": "Nothing related."}\n```'))).toEqual({ ok: true, reply: { answer: 'Nothing related.', related: [] } });
  });

  it('explains an error of the agent, and refuses text it cannot use', () => {
    expect(parseChatOutput(envelope('Not signed in', true))).toEqual({ ok: false, problem: 'The agent could not finish: Not signed in.' });
    expect(parseChatOutput('not json').ok).toBe(false);
    expect(parseChatOutput(envelope('I do not know')).ok).toBe(false);
    expect(parseChatOutput(reply('  '))).toEqual({ ok: false, problem: 'The agent returned an empty answer.' });
  });

  it('turns references into real tasks, with the status of the task, and drops the ones that match nothing', () => {
    const done = task({ title: 'Export invoices', status: 'done', archivedAt: '2026-01-02' });
    const idea = { ...task({ title: 'Imported', status: 'idea' }), number: undefined };
    const related = resolveRelated([`#${done.number}`, `acme#${done.number}`, idea.id, '#9999', 'made up'], [done, idea]);
    expect(related).toEqual([
      { taskId: done.id, number: done.number, title: 'Export invoices', status: 'done', archived: true },
      { taskId: idea.id, number: undefined, title: 'Imported', status: 'idea', archived: false },
    ]);
  });
});

describe('the prompt of the chat', () => {
  const context = { text: '### #1 Export invoices\nStatus: done', withoutDescription: 0 };

  it('carries the tasks, the question, and the rule to use nothing else', () => {
    const prompt = buildBacklogChatPrompt({ company: { name: 'Acme' }, context, history: [], question: 'Do we export invoices?' });
    expect(prompt).toContain('## Tasks of Acme');
    expect(prompt).toContain('### #1 Export invoices\nStatus: done');
    expect(prompt).toContain('## Question\nDo we export invoices?');
    expect(prompt).toContain('You know only the tasks listed below');
    expect(prompt).toContain('done, is planned (backlog or to do), or is in progress');
    expect(prompt).not.toContain('## Conversation so far');
    expect(prompt).not.toContain('older tasks are listed without');
    expect(prompt.trimEnd().endsWith('"related": ["<the reference of each related task, such as #12>"]}')).toBe(true);
  });

  it('adds the earlier turns and says when descriptions were left out', () => {
    const prompt = buildBacklogChatPrompt({
      company: { name: 'Acme' },
      context: { ...context, withoutDescription: 4 },
      history: [
        { role: 'person', text: 'Do we export invoices?' },
        { role: 'assistant', text: 'Yes, #1 is done.' },
      ],
      question: 'And as PDF?',
    });
    expect(prompt).toContain('## Conversation so far\nPerson: Do we export invoices?\nYou: Yes, #1 is done.');
    expect(prompt).toContain('4 older tasks are listed without their description');
  });
});

describe('launching the agent for the chat', () => {
  it('gives it no tool, no folder, no server and no key, and sends the prompt through standard input', () => {
    const launch = buildChatLaunch(claude, 'the prompt', '/bin');
    expect(launch.input).toBe('the prompt');
    expect(launch.args).not.toContain('the prompt');
    expect(launch.args.slice(0, 3)).toEqual(['-p', '--output-format', 'json']);
    expect(launch.args[launch.args.indexOf('--tools') + 1]).toBe('');
    expect(launch.args[launch.args.indexOf('--disallowedTools') + 1]?.split(',')).toEqual(CHAT_BLOCKED_TOOLS);
    expect(CHAT_BLOCKED_TOOLS).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'Agent']));
    expect(launch.args).toContain('--strict-mcp-config');
    for (const flag of ['--add-dir', '--allowedTools', '--mcp-config', '--dangerously-skip-permissions', '--plugin-dir']) expect(launch.args).not.toContain(flag);
    expect(launch.args).toEqual(expect.arrayContaining(['--model', 'opus']));
    expect(launch.env).toMatchObject({ CLAUDE_CONFIG_DIR: '/cfg/work', CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });
  });

  it('refuses GitHub Copilot accounts for now', () => {
    expect(() => buildChatLaunch({ ...claude, type: 'github-copilot' }, 'p', '/bin')).toThrow('Only Claude Code accounts');
  });
});

describe('the backlog chat', () => {
  let home: TestHome;
  let bin: string;
  let repo: string;
  let done: Task;
  let doing: Task;
  let idea: Task;

  beforeEach(() => {
    home = makeHome('hatstand-chat-');
    bin = home.folder('bin');
    repo = home.folder('code', 'api');
    writeFileSync(join(bin, 'claude'), '#!/bin/sh\n');
    chmodSync(join(bin, 'claude'), 0o755);
    const { store } = home;
    store.saveAccount(claude);
    store.saveCompany({ ...store.createCompany('Acme', '#112233'), projects: [{ id: 'api', name: 'api', path: repo }], skipPermissions: true, defaultAccountId: claude.id });
    store.createCompany('Other', '#445566');
    done = store.updateTask(store.createTask({ companyId: 'acme', title: 'Export invoices', description: 'As CSV' }).id, { status: 'done' });
    doing = store.updateTask(store.createTask({ companyId: 'acme', title: 'Dark mode' }).id, { status: 'doing' });
    idea = store.createTask({ companyId: 'acme', title: 'Login page' }, undefined, 'idea');
    store.createTask({ companyId: 'acme', title: 'Billing emails' });
    store.createTask({ companyId: 'other', title: 'Secret plan of another client' });
  });

  afterEach(() => home.remove());

  const question = { key: 'chat', companyId: 'acme', question: 'Do we export invoices?' };
  const answering = (stdout = reply('Already done.')) => vi.fn<AgentRunner>(async () => ({ stdout }));
  const chat = (runner: AgentRunner, path = bin) => new BacklogChat(home.paths, home.store, path, runner);
  const sent = (runner: ReturnType<typeof answering>) => runner.mock.calls.at(-1)?.[1].input ?? '';

  it('sends the tasks of the client with their status, and none of another client', async () => {
    const runner = answering();
    await chat(runner).ask(question);
    const prompt = sent(runner);
    expect(prompt).toContain(`### #${done.number} Export invoices\nStatus: done`);
    expect(prompt).toContain(`### #${doing.number} Dark mode\nStatus: in progress`);
    expect(prompt).toContain(`### #${idea.number} Login page\nStatus: backlog`);
    expect(prompt).toContain('Billing emails\nStatus: to do');
    expect(prompt).toContain('> As CSV');
    expect(prompt).toContain('## Question\nDo we export invoices?');
    expect(prompt).not.toContain('Secret plan');
  });

  it('runs the agent in an empty folder, with no repository, knowledge or area folder in reach', async () => {
    const runner = answering();
    await chat(runner).ask(question);
    const [executable, launch, cwd] = runner.mock.calls[0] ?? [];
    expect(executable).toBe(join(bin, 'claude'));
    expect(launch?.env.CLAUDE_CONFIG_DIR).toBe('/cfg/work');
    expect(cwd).toBe(home.paths.chatDir);
    expect(readdirSync(home.paths.chatDir)).toEqual([]);
    const everything = [...(launch?.args ?? []), launch?.input ?? '', cwd].join('\n');
    for (const folder of [repo, home.paths.knowledgeDir('acme'), home.paths.areasDir('acme'), home.paths.company('acme')]) expect(everything).not.toContain(folder);
    expect(launch?.args).not.toContain('--add-dir');
    expect(launch?.args).not.toContain('--dangerously-skip-permissions');
  });

  it('returns the answer with the related tasks as they really are', async () => {
    const runner = answering(reply('Done in the export task, and dark mode is running.', [`#${done.number}`, `#${doing.number}`, '#404']));
    expect(await chat(runner).ask(question)).toEqual({
      answer: 'Done in the export task, and dark mode is running.',
      related: [
        { taskId: done.id, number: done.number, title: 'Export invoices', status: 'done', archived: false },
        { taskId: doing.id, number: doing.number, title: 'Dark mode', status: 'doing', archived: false },
      ],
    });
  });

  it('sends the earlier turns with a follow-up, but only the latest ones', async () => {
    const runner = answering();
    const history = Array.from({ length: MAX_CHAT_HISTORY + 2 }, (_, index) => ({ role: 'person' as const, text: `turn ${index}` }));
    await chat(runner).ask({ ...question, history });
    expect(sent(runner)).toContain(`Person: turn ${MAX_CHAT_HISTORY + 1}`);
    expect(sent(runner)).toContain('Person: turn 2\n');
    expect(sent(runner)).not.toContain('Person: turn 1\n');
  });

  it('says when the agent took too long', async () => {
    await expect(chat(async () => ({ stdout: '', failure: 'timeout' })).ask(question)).rejects.toThrow('The agent took more than 2 minutes');
  });

  it('says why the agent failed, with its own reason when it gives one', async () => {
    await expect(chat(async () => ({ stdout: '', failure: 'failed', detail: 'exit 1' })).ask(question)).rejects.toThrow('The agent stopped with an error: exit 1. Check that it is signed in');
    await expect(chat(async () => ({ stdout: envelope('Credit balance too low', true), failure: 'failed', detail: 'exit 1' })).ask(question)).rejects.toThrow('Credit balance too low');
  });

  it('says when the answer cannot be used', async () => {
    await expect(chat(answering(envelope('Sure, let me think.'))).ask(question)).rejects.toThrow('did not return an answer Hatstand can use');
  });

  it('says when the question was cancelled', async () => {
    const runner: AgentRunner = (_executable, _launch, _cwd, signal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve({ stdout: '', failure: 'cancelled' })));
    const backlogChat = chat(runner);
    const asked = backlogChat.ask(question);
    backlogChat.cancel('chat');
    await expect(asked).rejects.toThrow('The question was cancelled.');
  });

  it('cancels the earlier question when the same chat asks again', async () => {
    const signals: AbortSignal[] = [];
    const runner: AgentRunner = (_executable, _launch, _cwd, signal) => {
      signals.push(signal);
      return new Promise((resolve) => {
        if (signals.length === 1) signal.addEventListener('abort', () => resolve({ stdout: '', failure: 'cancelled' }));
        else resolve({ stdout: reply('Second') });
      });
    };
    const backlogChat = chat(runner);
    const first = backlogChat.ask(question);
    const second = backlogChat.ask(question);
    await expect(first).rejects.toThrow('cancelled');
    await expect(second).resolves.toMatchObject({ answer: 'Second' });
    expect(signals[0]?.aborted).toBe(true);
  });

  it('says when claude is not installed, or the account is not Claude Code', async () => {
    await expect(chat(vi.fn(), home.folder('empty')).ask(question)).rejects.toThrow('claude was not found');
    home.store.saveAccount({ ...claude, type: 'github-copilot' });
    await expect(chat(vi.fn()).ask(question)).rejects.toThrow('Only Claude Code accounts');
  });

  it('runs a real program, which reads the prompt from standard input', async () => {
    const seen = join(home.folder('seen'), 'prompt.txt');
    writeFileSync(join(bin, 'claude'), `#!/bin/sh\n/bin/cat > '${seen}'\nprintf '%s' '${reply('From the program')}'\n`);
    const result = await new BacklogChat(home.paths, home.store, bin).ask(question);
    expect(result.answer).toBe('From the program');
    expect(readFileSync(seen, 'utf8')).toContain('## Question\nDo we export invoices?');
  });

  it('is answered by the backlog service', async () => {
    const deps = fakeServiceDeps();
    vi.mocked(deps.backlogChat.ask).mockResolvedValue({ answer: 'Nothing related.', related: [] });
    const services = createServices(makeServiceContext(home).ctx, deps);
    expect(await services.askBacklogChat(question)).toEqual({ answer: 'Nothing related.', related: [] });
    await services.cancelBacklogChat('chat');
    expect(deps.backlogChat.ask).toHaveBeenCalledWith(question);
    expect(deps.backlogChat.cancel).toHaveBeenCalledWith('chat');
  });
});
