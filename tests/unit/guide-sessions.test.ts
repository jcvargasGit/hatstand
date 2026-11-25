import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Task, TaskGuide } from '../../src/shared/schemas';
import { githubCopilot } from '../../src/main/agents/github-copilot';
import { dataPaths, type DataPaths } from '../../src/main/paths';
import { SessionManager } from '../../src/main/sessions';
import { parseStepsDone, STEP_DONE_TOOL, withStepsDone } from '../../src/main/step-done-tool';
import { Store } from '../../src/main/store';
import { fakeAgentBin, fakeProtection, noSecrets } from '../helpers/sessions';

const written = vi.hoisted(() => [] as string[]);
const lastSpawn = vi.hoisted(() => ({ exit: (() => {}) as () => void, output: (() => {}) as (data: string) => void, env: {} as Record<string, string>, args: [] as string[] }));

vi.mock('node-pty', () => ({
  spawn: (_file: string, args: string[], options: { env: Record<string, string> }) => {
    lastSpawn.env = options.env;
    lastSpawn.args = args;
    return {
      write: (data: string) => written.push(data),
      onData: (listener: (data: string) => void) => {
        lastSpawn.output = listener;
      },
      onExit: (listener: () => void) => {
        lastSpawn.exit = listener;
      },
      kill: () => {},
      resize: () => {},
    };
  },
}));

const guide: TaskGuide = {
  playbookId: 'x',
  name: 'Check',
  current: 0,
  promptPending: false,
  done: [],
  steps: [{ name: 'Read', prompt: 'Read it.' }, { name: 'Fix', prompt: 'Fix it.' }, { name: 'Ask', you: 'Ask them.' }],
};

let dir: string;
let paths: DataPaths;
let store: Store;
let sessions: SessionManager;
let onChange: Mock<() => void>;

beforeEach(() => {
  vi.useFakeTimers();
  written.length = 0;
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-guide-')));
  const bin = fakeAgentBin(dir);
  paths = dataPaths(join(dir, 'home'));
  store = new Store(paths);
  store.saveCompany({ ...store.createCompany('Acme', '#112233'), rootDir: dir });
  onChange = vi.fn<() => void>();
  sessions = new SessionManager(paths, store, noSecrets, bin, { onData: () => {}, onChange, onNeedsInput: () => {} }, fakeProtection());
});

afterEach(() => {
  sessions.stopAll();
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

async function startTask() {
  const task = store.createTask({ companyId: 'acme', title: 'Fix', description: '', projectIds: [] } as never);
  store.updateTask(task.id, { guide });
  const session = await sessions.start(task.id);
  lastSpawn.output('ready');
  vi.advanceTimersByTime(1000);
  sessions.write(session.id, '\x15');
  const saved = () => store.listSessions().find((item) => item.id === session.id);
  const setAgent = (state: string) => {
    writeFileSync(paths.statusFile(session.id), state);
    vi.advanceTimersByTime(1000);
  };
  return { taskId: task.id, sessionId: session.id, saved, setAgent };
}

describe('the first session of a task', () => {
  const create = (change: Partial<Task> = {}) => {
    const task = store.createTask({ companyId: 'acme', title: 'Fix', description: '', projectIds: [] } as never);
    if (Object.keys(change).length > 0) store.updateTask(task.id, change);
    return task.id;
  };
  const settle = () => {
    lastSpawn.output('ready');
    vi.advanceTimersByTime(1000);
  };

  it('sends its opening prompt by itself, so the agent starts working at once', async () => {
    const taskId = create();
    const session = await sessions.start(taskId);
    written.length = 0;
    settle();
    expect(written[0]).toContain('Review the task');
    expect(written.at(-1)).toBe('\r');
    expect(store.listSessions().find((item) => item.id === session.id)?.draft).toBe(false);
  });

  it('gives Claude Code its own folders through settings and a repository elsewhere through --add-dir', async () => {
    const api = join(dir, 'api');
    const web = join(dir, 'web');
    const repositories = [api, web];
    repositories.forEach((folder) => mkdirSync(folder));
    store.saveCompany({ ...store.readCompany('acme'), rootDir: undefined, projects: repositories.map((path) => ({ id: path, name: path, path })) } as never);
    const session = await sessions.start(create({ projectIds: repositories }));
    const added = lastSpawn.args.filter((_arg, index) => lastSpawn.args[index - 1] === '--add-dir');
    const { permissions } = JSON.parse(readFileSync(paths.settingsFile(session.id), 'utf8'));
    expect(permissions.additionalDirectories).toEqual(expect.arrayContaining([paths.knowledgeDir('acme'), paths.tasksDir('acme')]));
    expect(added.filter((folder) => folder.startsWith(paths.home))).toEqual([]);
    expect([...added, session.cwd]).toEqual(expect.arrayContaining([api, web]));
    expect(added.length).toBeGreaterThan(0);
  });

  it('sends the first step of its guide', async () => {
    const taskId = create({ guide });
    await sessions.start(taskId);
    written.length = 0;
    settle();
    expect(written).toEqual([expect.stringContaining('Step 1 of 3, Read'), '\r']);
  });

  it('waits for Enter on a later session', async () => {
    const taskId = create();
    const first = await sessions.start(taskId);
    settle();
    sessions.stop(first.id);
    lastSpawn.exit();
    await sessions.start(taskId);
    written.length = 0;
    settle();
    expect(written).toEqual([expect.stringContaining('Review the task')]);
  });

  it('waits for Enter on a step that needs approval, and writes nothing for a step the person does', async () => {
    const approval = create({ guide: { ...guide, steps: [{ name: 'Post', prompt: 'Post it.', approval: true }] } });
    await sessions.start(approval);
    written.length = 0;
    settle();
    expect(written).toEqual([expect.stringContaining('Step 1 of 1, Post')]);
    sessions.stopAll();
    const yours = create({ guide: { ...guide, current: 2 } });
    await sessions.start(yours);
    written.length = 0;
    settle();
    expect(written).toEqual([]);
  });

  it('does not send a prompt someone else asked to write, such as review feedback', async () => {
    const taskId = create();
    await sessions.sendPrompt(taskId, 'Read the feedback');
    written.length = 0;
    settle();
    expect(written).toEqual(['Read the feedback']);
  });

  it('does not press Enter while the agent asks a question, such as a permission', async () => {
    const taskId = create();
    const session = await sessions.start(taskId);
    writeFileSync(paths.statusFile(session.id), 'needs-input');
    written.length = 0;
    settle();
    expect(written).toEqual([expect.stringContaining('Review the task')]);
  });

  it('leaves the prompt for the person when the agent asked a question as it was written, even once it is answered', async () => {
    const taskId = create({ guide });
    const session = await sessions.start(taskId);
    writeFileSync(paths.statusFile(session.id), 'needs-input');
    lastSpawn.output('ready');
    written.length = 0;
    vi.advanceTimersByTime(700);
    writeFileSync(paths.statusFile(session.id), 'idle');
    vi.advanceTimersByTime(1000);
    expect(written).toEqual([expect.stringContaining('Step 1 of 3, Read')]);
    expect(store.listSessions().find((item) => item.id === session.id)).toMatchObject({ state: 'idle', draft: true });
  });

  it('does not send when the person typed over it first', async () => {
    const taskId = create();
    const session = await sessions.start(taskId);
    lastSpawn.output('ready');
    vi.advanceTimersByTime(700);
    sessions.write(session.id, '\x15');
    written.length = 0;
    vi.advanceTimersByTime(1000);
    expect(written).toEqual([]);
  });
});

describe('opening a session again', () => {
  const stopped = async () => {
    const task = store.createTask({ companyId: 'acme', title: 'Fix', description: '', projectIds: [] } as never);
    const session = await sessions.start(task.id);
    sessions.stop(session.id);
    lastSpawn.exit();
    return { taskId: task.id, sessionId: session.id };
  };
  const recordTranscript = (sessionId: string, file: string) => writeFileSync(paths.activityFile(sessionId), `${JSON.stringify({ hook_event_name: 'SessionStart', transcript_path: file })}\n`);
  const typed = () => {
    lastSpawn.output('ready');
    vi.advanceTimersByTime(1000);
    return written.join('');
  };

  it('starts over with its prompt when no message was ever sent, so nothing is lost', async () => {
    const { sessionId } = await stopped();
    recordTranscript(sessionId, join(dir, 'never-written.jsonl'));
    written.length = 0;
    sessions.resume(sessionId);
    expect(lastSpawn.args.slice(0, 2)).toEqual(['--session-id', sessionId]);
    expect(typed()).toContain('Review the task');
  });

  it('continues the conversation when it was saved', async () => {
    const { sessionId } = await stopped();
    const transcript = join(dir, 'saved.jsonl');
    writeFileSync(transcript, '{}\n');
    recordTranscript(sessionId, transcript);
    written.length = 0;
    sessions.resume(sessionId);
    expect(lastSpawn.args.slice(0, 2)).toEqual(['--resume', sessionId]);
    expect(typed()).not.toContain('Review the task');
  });

  it('still resumes when the agent never said where it saves', async () => {
    const { sessionId } = await stopped();
    writeFileSync(paths.activityFile(sessionId), '');
    sessions.resume(sessionId);
    expect(lastSpawn.args.slice(0, 2)).toEqual(['--resume', sessionId]);
  });
});

describe('text in the terminal', () => {
  it('tells the interface once, not on every key', async () => {
    const { sessionId, saved } = await startTask();
    onChange.mockClear();
    sessions.write(sessionId, 'a');
    sessions.write(sessionId, 'b');
    expect(saved()?.draft).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    sessions.write(sessionId, '\x7f');
    sessions.write(sessionId, '\x7f');
    expect(saved()?.draft).toBe(false);
  });

  it('treats Shift+Enter as a new line, not as an answer to the agent', async () => {
    const { sessionId, saved, setAgent } = await startTask();
    setAgent('needs-input');
    sessions.write(sessionId, 'x');
    sessions.write(sessionId, '\x1b\r');
    vi.advanceTimersByTime(1000);
    expect(readFileSync(paths.statusFile(sessionId), 'utf8')).toBe('needs-input');
    expect(saved()?.state).toBe('needs-input');
    sessions.write(sessionId, '\r');
    expect(readFileSync(paths.statusFile(sessionId), 'utf8')).toBe('working');
  });

  it('does not count keys that answer a permission question', async () => {
    const { sessionId, saved, setAgent } = await startTask();
    setAgent('needs-input');
    sessions.write(sessionId, '1');
    expect(saved()?.draft).toBeFalsy();
  });

  it('never writes a step over the text, and writes it once the text is gone', async () => {
    const { taskId, sessionId, saved } = await startTask();
    sessions.write(sessionId, 'my words');
    written.length = 0;
    expect(() => sessions.moveGuideStep(taskId, 1)).toThrow(/still in the terminal/);
    expect(written).toEqual([]);
    expect(store.findTask(taskId).guide?.current).toBe(0);

    sessions.write(sessionId, '\x15');
    sessions.moveGuideStep(taskId, 1);
    expect(written.at(-1)).toContain('Step 2 of 3, Fix');
    expect(saved()?.draft).toBe(true);
  });

  it('does not let a second click stack two prompts', async () => {
    const { taskId } = await startTask();
    sessions.moveGuideStep(taskId, 1);
    expect(() => sessions.moveGuideStep(taskId, 2)).toThrow(/still in the terminal/);
  });

  it('does not write review feedback over the text', async () => {
    const { taskId, sessionId } = await startTask();
    sessions.write(sessionId, 'x');
    await expect(sessions.sendPrompt(taskId, 'Read the feedback')).rejects.toThrow(/still in the terminal/);
  });

  it('forgets the text when the session ends', async () => {
    const { sessionId, saved } = await startTask();
    sessions.write(sessionId, 'x');
    lastSpawn.exit();
    expect(saved()?.draft).toBe(false);
    expect(saved()?.state).toBe('stopped');
  });
});

describe('sending the text', () => {
  it('presses only Enter, and empties the box', async () => {
    const { sessionId, saved } = await startTask();
    sessions.write(sessionId, 'x');
    written.length = 0;
    sessions.sendDraft(sessionId);
    expect(written).toEqual(['\r']);
    expect(saved()?.draft).toBe(false);
  });

  it('does not answer a permission question it has only just heard about', async () => {
    const { sessionId } = await startTask();
    sessions.write(sessionId, 'x');
    writeFileSync(paths.statusFile(sessionId), 'needs-input');
    written.length = 0;
    expect(() => sessions.sendDraft(sessionId)).toThrow(/busy or asking/);
    expect(written).toEqual([]);
  });

  it('refuses when there is no text, or no session', async () => {
    const { sessionId } = await startTask();
    expect(() => sessions.sendDraft(sessionId)).toThrow(/no text/);
    expect(() => sessions.sendDraft('gone')).toThrow(/not running/);
  });
});

describe('the agent saying a step is finished', () => {
  const runTool = (args: string[], file?: string) => {
    const tool = join(dir, 'step-done');
    writeFileSync(tool, STEP_DONE_TOOL);
    chmodSync(tool, 0o755);
    return spawnSync(tool, args, { env: file ? { HATSTAND_STEP_FILE: file } : {}, encoding: 'utf8' });
  };

  it('installs the command, on the PATH of every session', async () => {
    await startTask();
    expect(existsSync(paths.stepDoneTool)).toBe(true);
    expect(lastSpawn.env.PATH?.split(':')[0]).toBe(paths.toolsDir);
  });

  it('reaches the guide of the task through the command', async () => {
    const { taskId, sessionId } = await startTask();
    const result = runTool(['1'], lastSpawn.env.HATSTAND_STEP_FILE);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('you finished step 1');
    expect(readFileSync(paths.stepFile(sessionId), 'utf8')).toBe('1\n');
    onChange.mockClear();
    vi.advanceTimersByTime(1000);
    expect(store.findTask(taskId).guide?.done).toEqual([1]);
    expect(onChange).toHaveBeenCalled();
    expect(existsSync(paths.stepFile(sessionId))).toBe(false);
  });

  it('keeps every step reported, also those done while talking and out of order', async () => {
    const { taskId } = await startTask();
    runTool(['3'], lastSpawn.env.HATSTAND_STEP_FILE);
    runTool(['2', '1'], lastSpawn.env.HATSTAND_STEP_FILE);
    vi.advanceTimersByTime(1000);
    expect(store.findTask(taskId).guide?.done).toEqual([1, 2, 3]);
    expect(store.findTask(taskId).guide?.current).toBe(0);
  });

  it('keeps what was reported when the person sends another prompt or changes step', async () => {
    const { taskId, sessionId } = await startTask();
    writeFileSync(paths.stepFile(sessionId), '1\n');
    vi.advanceTimersByTime(1000);
    const { hooks } = JSON.parse(readFileSync(paths.settingsFile(sessionId), 'utf8')) as { hooks: { UserPromptSubmit: { hooks: { command: string }[] }[] } };
    expect(JSON.stringify(hooks.UserPromptSubmit)).not.toContain('HATSTAND_STEP_FILE');
    sessions.moveGuideStep(taskId, 1);
    vi.advanceTimersByTime(1000);
    expect(store.findTask(taskId).guide).toMatchObject({ current: 1, done: [1] });
  });

  it('sends the next step by itself for a guide that continues, once the agent is back at its prompt', async () => {
    const { taskId, sessionId, setAgent } = await startTask();
    sessions.setGuideAutoContinue(taskId, true);
    setAgent('working');
    written.length = 0;
    writeFileSync(paths.stepFile(sessionId), '1\n');
    vi.advanceTimersByTime(1000);
    expect(written).toEqual([]);
    setAgent('idle');
    vi.advanceTimersByTime(1000);
    expect(written.join('')).toContain('Step 2 of 3, Fix: Fix it.');
    expect(written.join('')).toContain('Continue without asking me to confirm.');
    expect(written.at(-1)).toBe('\r');
    expect(store.findTask(taskId).guide).toMatchObject({ current: 1, done: [1] });
  });

  it('stops by itself before the step the person does, and waits when the agent asks something', async () => {
    const { taskId, sessionId, setAgent } = await startTask();
    sessions.setGuideAutoContinue(taskId, true);
    setAgent('working');
    writeFileSync(paths.stepFile(sessionId), '1\n');
    setAgent('needs-input');
    written.length = 0;
    vi.advanceTimersByTime(3000);
    expect(written).toEqual([]);
    expect(store.findTask(taskId).guide?.current).toBe(0);
    setAgent('idle');
    vi.advanceTimersByTime(1000);
    expect(store.findTask(taskId).guide?.current).toBe(1);
    setAgent('working');
    writeFileSync(paths.stepFile(sessionId), '2\n');
    setAgent('idle');
    written.length = 0;
    vi.advanceTimersByTime(3000);
    expect(written).toEqual([]);
    expect(store.findTask(taskId).guide).toMatchObject({ current: 1, done: [1, 2] });
  });

  it('ignores a step the guide does not have', async () => {
    const { taskId, sessionId } = await startTask();
    writeFileSync(paths.stepFile(sessionId), '9\n2\n');
    vi.advanceTimersByTime(1000);
    expect(store.findTask(taskId).guide?.done).toEqual([2]);
  });

  it('counts a step the person does as finished once they move past it, not when they go back', async () => {
    const { taskId, sessionId } = await startTask();
    store.updateTask(taskId, { guide: { ...guide, steps: [{ name: 'Sign in', you: 'Sign in yourself.' }, ...guide.steps], current: 0 } });
    sessions.moveGuideStep(taskId, 1);
    expect(store.findTask(taskId).guide).toMatchObject({ current: 1, done: [1] });
    sessions.write(sessionId, '\x15');
    store.updateTask(taskId, { guide: { ...(store.findTask(taskId).guide as TaskGuide), current: 3 } });
    sessions.moveGuideStep(taskId, 0);
    expect(store.findTask(taskId).guide?.done).toEqual([1]);
  });

  it('reads step numbers, and keeps them in order and within the guide', () => {
    expect(parseStepsDone('2\n1\n2\n')).toEqual([2, 1]);
    for (const text of ['', '0', '-1', 'done', '1.5', '03']) expect(parseStepsDone(text)).toEqual([]);
    expect(withStepsDone([3], [1, 5], 4)).toEqual([1, 3]);
  });
});

describe('GitHub Copilot', () => {
  it('runs the step command without asking, and keeps the reports on a new prompt', () => {
    const { args } = githubCopilot.buildLaunch({ account: { type: 'github-copilot' }, company: { name: 'A', context: { pluginDirs: [] } }, task: { title: 'T' }, sessionId: 's', sessionDir: '/s', notesFile: '/n', resume: false, promptFile: '/p', settingsFile: '/f', ownDirs: [], addDirs: [] } as never);
    expect(args).toContain('--allow-tool=shell(hatstand-step-done:*)');
    const stepFile = join(dir, 'step');
    const statusFile = join(dir, 'status');
    writeFileSync(stepFile, '1\n');
    const { hooks } = JSON.parse(githubCopilot.buildStatusSettings()) as { hooks: { userPromptSubmitted: { bash: string }[] } };
    spawnSync('sh', ['-c', hooks.userPromptSubmitted[0]?.bash ?? ''], { input: '{}', env: { PATH: process.env.PATH, HATSTAND_STEP_FILE: stepFile, HATSTAND_STATUS_FILE: statusFile } });
    expect(readFileSync(stepFile, 'utf8')).toBe('1\n');
    expect(readFileSync(statusFile, 'utf8')).toBe('working');
  });
});
