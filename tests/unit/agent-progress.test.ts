import { describe, expect, it } from 'vitest';
import { BACKGROUND_LIMIT_MS, QUIET_TURN_MS, readAgentProgress, sessionStateFrom, transcriptPathFrom, type AgentProgress } from '../../src/main/agents/agent-progress';

const NOW = Date.parse('2026-11-05T21:00:00Z');
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const lines = (...entries: unknown[]) => entries.map((entry) => JSON.stringify(entry)).join('\n');
const launch = (id: string, msAgo = 1000, name = 'Bash') => ({ type: 'assistant', timestamp: at(msAgo), message: { content: [{ type: 'tool_use', id, name, input: { run_in_background: true } }] } });
const tool = (id: string) => ({ type: 'assistant', timestamp: at(900), message: { content: [{ type: 'tool_use', id, name: 'Bash', input: {} }] } });
const result = (id: string, text = 'ok') => ({ type: 'user', timestamp: at(800), message: { content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });
const finished = (id: string) => ({ type: 'user', timestamp: at(500), message: { content: `<task-notification><tool-use-id>${id}</tool-use-id><status>completed</status></task-notification>` } });
const prompt = (text = 'Do it') => ({ type: 'user', timestamp: at(1000), message: { content: text } });
const stop = { type: 'system', subtype: 'stop_hook_summary', timestamp: at(400) };
const progress = (text: string, startedAt = 0) => readAgentProgress(text, startedAt, NOW);

describe('reading the turn of an agent from its transcript', () => {
  it('sees a turn in progress, and a tool still running', () => {
    expect(progress(lines(prompt(), tool('a')))).toMatchObject({ turnOpen: true, toolRunning: true });
    expect(progress(lines(prompt(), tool('a'), result('a')))).toMatchObject({ turnOpen: true, toolRunning: false });
    expect(progress(lines(prompt(), tool('a'), result('a'), stop))).toMatchObject({ turnOpen: false, toolRunning: false });
  });

  it('counts work left in the background when the turn ends', () => {
    expect(progress(lines(launch('a'), result('a'), stop))).toMatchObject({ pending: 1, turnOpen: false });
  });

  it('sees the agent wake up by itself when that work finishes, and end that turn', () => {
    expect(progress(lines(launch('a'), result('a'), stop, finished('a')))).toMatchObject({ pending: 0, turnOpen: true });
    expect(progress(lines(launch('a'), result('a'), stop, finished('a'), stop))).toMatchObject({ pending: 0, turnOpen: false });
  });

  it('also sees work that finished through the queue of the agent', () => {
    const queued = { type: 'queue-operation', operation: 'enqueue', timestamp: at(500), content: finished('a').message.content };
    expect(progress(lines(launch('a'), result('a'), queued, stop))).toMatchObject({ pending: 0, turnOpen: false });
  });

  it('keeps counting what is still running after another finishes', () => {
    expect(progress(lines(launch('a'), launch('b'), stop, finished('a'), stop)).pending).toBe(1);
  });

  it('stops counting work the agent stopped', () => {
    const kill = { type: 'assistant', timestamp: at(700), message: { content: [{ type: 'tool_use', id: 'k', name: 'TaskStop', input: { task_id: 'shell-1' } }] } };
    expect(progress(lines(launch('a'), result('a', 'Running in background with ID: shell-1'), kill, stop)).pending).toBe(0);
  });

  it('knows when you interrupted the agent, until you write again', () => {
    expect(progress(lines(prompt(), tool('a'), prompt('[Request interrupted by user]')))).toMatchObject({ interrupted: true, turnOpen: false, toolRunning: false });
    expect(progress(lines(prompt(), prompt('[Request interrupted by user]'), prompt()))).toMatchObject({ interrupted: false, turnOpen: true });
  });

  it('does not take local commands or system notes as a turn', () => {
    expect(progress(lines(prompt('<local-command-stdout>x</local-command-stdout>'), { ...prompt('note'), isMeta: true })).turnOpen).toBe(false);
  });

  it('ignores what happened before this run of the agent, and gives up on old work', () => {
    expect(progress(lines(prompt(), tool('a'), launch('b', 5000)), NOW - 100)).toEqual({ pending: 0, turnOpen: false, toolRunning: false, interrupted: false });
    expect(progress(lines(launch('a', BACKGROUND_LIMIT_MS + 1))).pending).toBe(0);
  });

  it('ignores other background tools and lines it cannot read', () => {
    expect(progress(`not json\n${lines(launch('a', 1000, 'Skill'), { nothing: true })}`).pending).toBe(0);
  });

  it('finds the transcript in the latest event that names it', () => {
    expect(transcriptPathFrom(`bad\n${lines({ transcript_path: '/old' }, { transcript_path: '/new' }, { other: 1 })}`)).toBe('/new');
    expect(transcriptPathFrom('')).toBeUndefined();
  });
});

describe('the state shown for a session', () => {
  const quiet: AgentProgress = { pending: 0, turnOpen: false, toolRunning: false, interrupted: false };

  it('never hides that the agent needs an answer', () => {
    expect(sessionStateFrom('needs-input', { ...quiet, turnOpen: true, toolRunning: true }, 0)).toBe('needs-input');
  });

  it('shows Working when a late idle report arrives during a turn', () => {
    expect(sessionStateFrom('idle', { ...quiet, turnOpen: true }, 1000)).toBe('working');
    expect(sessionStateFrom('idle', { ...quiet, turnOpen: true, toolRunning: true }, QUIET_TURN_MS * 10)).toBe('working');
  });

  it('does not stay in Working when a turn ended without a report', () => {
    expect(sessionStateFrom('idle', { ...quiet, turnOpen: true }, QUIET_TURN_MS + 1)).toBe('idle');
    expect(sessionStateFrom('working', { ...quiet, interrupted: true }, 0)).toBe('idle');
  });

  it('shows background work only after the turn ended', () => {
    expect(sessionStateFrom('idle', { ...quiet, pending: 1 }, 0)).toBe('background');
    expect(sessionStateFrom('working', { ...quiet, pending: 1 }, 0)).toBe('background');
    expect(sessionStateFrom('working', { ...quiet, pending: 1, turnOpen: true }, 0)).toBe('working');
  });

  it('trusts the agent otherwise', () => {
    expect(sessionStateFrom('working', quiet, 0)).toBe('working');
    expect(sessionStateFrom('idle', quiet, 0)).toBe('idle');
  });
});
