import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { TaskGuide } from '../../src/shared/schemas';
import { githubCopilot } from '../../src/main/agents/github-copilot';
import { dataPaths, type DataPaths } from '../../src/main/paths';
import type { SecretStore } from '../../src/main/secrets';
import { SessionManager } from '../../src/main/sessions';
import { CLEAR_STEP_DONE, parseStepDone, STEP_DONE_TOOL } from '../../src/main/step-done-tool';
import { Store } from '../../src/main/store';

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
  const bin = join(dir, 'bin');
  spawnSync('mkdir', [bin]);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\n');
  chmodSync(join(bin, 'claude'), 0o755);
  paths = dataPaths(join(dir, 'home'));
  store = new Store(paths);
  store.saveCompany({ ...store.createCompany('Acme', '#112233'), rootDir: dir });
  onChange = vi.fn<() => void>();
  sessions = new SessionManager(paths, store, { read: () => ({}) } as unknown as SecretStore, bin, { onData: () => {}, onChange, onNeedsInput: () => {} });
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

  it('reaches the session through the command', async () => {
    const { sessionId, saved } = await startTask();
    const result = runTool(['1'], lastSpawn.env.HATSTAND_STEP_FILE);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('stop here');
    expect(readFileSync(paths.stepFile(sessionId), 'utf8')).toBe('1');
    vi.advanceTimersByTime(1000);
    expect(saved()?.stepDone).toBe(1);
  });

  it('refuses a wrong call', () => {
    expect(runTool([], join(dir, 'f')).status).toBe(2);
    expect(runTool(['two'], join(dir, 'f')).status).toBe(2);
    expect(runTool(['1']).status).toBe(2);
    expect(existsSync(join(dir, 'f'))).toBe(false);
  });

  it('is forgotten when the person sends another prompt', async () => {
    const { sessionId, saved } = await startTask();
    writeFileSync(paths.stepFile(sessionId), '1');
    vi.advanceTimersByTime(1000);
    expect(saved()?.stepDone).toBe(1);
    spawnSync('sh', ['-c', CLEAR_STEP_DONE], { env: { HATSTAND_STEP_FILE: paths.stepFile(sessionId) } });
    vi.advanceTimersByTime(1000);
    expect(saved()?.stepDone).toBeUndefined();
  });

  it('is forgotten when the step changes, so coming back needs a new one', async () => {
    const { taskId, sessionId, saved } = await startTask();
    writeFileSync(paths.stepFile(sessionId), '1');
    vi.advanceTimersByTime(1000);
    sessions.moveGuideStep(taskId, 1);
    vi.advanceTimersByTime(1000);
    expect(saved()?.stepDone).toBeUndefined();
    expect(existsSync(paths.stepFile(sessionId))).toBe(false);
  });

  it('ignores anything that is not a step number', () => {
    expect(parseStepDone('2\n')).toBe(2);
    for (const text of ['', '0', '-1', 'done', '1.5']) expect(parseStepDone(text)).toBeUndefined();
  });
});

describe('GitHub Copilot', () => {
  it('runs the step command without asking, and forgets the signal on a new prompt', () => {
    const { args } = githubCopilot.buildLaunch({ account: { type: 'github-copilot' }, company: { name: 'A', context: { pluginDirs: [] } }, task: { title: 'T' }, sessionId: 's', sessionDir: '/s', notesFile: '/n', resume: false, promptFile: '/p', settingsFile: '/f', addDirs: [] } as never);
    expect(args).toContain('--allow-tool=shell(hatstand-step-done:*)');
    const stepFile = join(dir, 'step');
    const statusFile = join(dir, 'status');
    writeFileSync(stepFile, '1');
    const { hooks } = JSON.parse(githubCopilot.buildStatusSettings()) as { hooks: { userPromptSubmitted: { bash: string }[] } };
    spawnSync('sh', ['-c', hooks.userPromptSubmitted[0]?.bash ?? ''], { input: '{}', env: { PATH: process.env.PATH, HATSTAND_STEP_FILE: stepFile, HATSTAND_STATUS_FILE: statusFile } });
    expect(readFileSync(stepFile, 'utf8')).toBe('');
    expect(readFileSync(statusFile, 'utf8')).toBe('working');
  });
});
