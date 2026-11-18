import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claudeCode } from '../../src/main/agents/claude-code';
import { CLAUDE_WRITE_COMMAND, COPILOT_WRITE_COMMAND, parseFileWrites } from '../../src/main/agents/file-writes';
import { githubCopilot } from '../../src/main/agents/github-copilot';
import { parseSubagentActivity } from '../../src/main/agents/subagent-activity';
import { transcriptPathFrom } from '../../src/main/agents/agent-progress';

let dir: string;
let activity: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-writes-')));
  activity = join(dir, 'activity.jsonl');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Runs a hook the way the agent does: its input as JSON on stdin, and the activity file in the environment. */
const hook = (command: string, input: unknown) => {
  const result = spawnSync('sh', ['-c', command], { input: JSON.stringify(input), env: { PATH: process.env.PATH ?? '', HATSTAND_ACTIVITY_FILE: activity }, encoding: 'utf8' });
  expect(result.status).toBe(0);
};
const recorded = () => (existsSync(activity) ? readFileSync(activity, 'utf8') : '');

describe('the write hook of Claude Code', () => {
  it('is installed for the tools that write files, and leaves the status hook in place', () => {
    const { hooks } = JSON.parse(claudeCode.buildStatusSettings());
    expect(hooks.PostToolUse.map((item: { matcher: string }) => item.matcher)).toEqual(['*', 'Write|Edit|MultiEdit|NotebookEdit']);
    expect(hooks.PostToolUse[1].hooks[0].command).toBe(CLAUDE_WRITE_COMMAND);
  });

  it('records the path and whether the file is new, and never the content', () => {
    hook(CLAUDE_WRITE_COMMAND, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '/acme/notes/plan.md', content: 'secret words, and "file_path": "/acme/decoy.md"' },
      tool_response: { type: 'create', filePath: '/acme/notes/plan.md' },
    });
    hook(CLAUDE_WRITE_COMMAND, { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/acme/notes/old.md', old_string: 'a', new_string: '"type": "create"' } });
    hook(CLAUDE_WRITE_COMMAND, { hook_event_name: 'PostToolUse', tool_name: 'NotebookEdit', tool_input: { notebook_path: '/acme/data.ipynb' } });
    expect(recorded()).not.toContain('secret words');
    expect(parseFileWrites(recorded())).toEqual([
      { path: '/acme/notes/plan.md', kind: 'create' },
      { path: '/acme/notes/old.md', kind: 'update' },
      { path: '/acme/data.ipynb', kind: 'update' },
    ]);
  });

  it('keeps a path with quotes and spaces whole', () => {
    hook(CLAUDE_WRITE_COMMAND, { tool_name: 'Write', tool_input: { file_path: '/acme/my "draft" notes.md', content: '' } });
    expect(parseFileWrites(recorded())).toEqual([{ path: '/acme/my "draft" notes.md', kind: 'update' }]);
  });

  it('records nothing for an input without a file', () => {
    hook(CLAUDE_WRITE_COMMAND, { tool_name: 'Write', tool_input: {} });
    expect(recorded()).toBe('');
  });
});

describe('the write hook of GitHub Copilot', () => {
  it('is installed after the status hook', () => {
    const { hooks } = JSON.parse(githubCopilot.buildStatusSettings());
    expect(hooks.postToolUse).toHaveLength(2);
    expect(hooks.postToolUse[1].bash).toBe(COPILOT_WRITE_COMMAND);
  });

  it('records the files its tools create and edit, and not the ones it only reads', () => {
    const call = (toolName: string, toolArgs: unknown) => hook(COPILOT_WRITE_COMMAND, { timestamp: 1, cwd: '/acme', toolName, toolArgs: JSON.stringify(toolArgs), toolResult: { resultType: 'success' } });
    call('create', { path: '/acme/new.md', file_text: 'has "path": "/acme/decoy.md" inside' });
    call('edit', { path: '/acme/old.md', old_str: 'a', new_str: 'b' });
    call('str_replace_editor', { command: 'view', path: '/acme/seen.md' });
    call('str_replace_editor', { command: 'create', path: '/acme/made.md', file_text: 'x' });
    call('bash', { command: 'echo "path": "/acme/decoy.md"' });
    call('view', { path: '/acme/seen.md' });
    expect(parseFileWrites(recorded())).toEqual([
      { path: '/acme/new.md', kind: 'create' },
      { path: '/acme/old.md', kind: 'update' },
      { path: '/acme/made.md', kind: 'create' },
    ]);
  });

  it('records every file of a patch, with paths relative to the folder it ran in', () => {
    const patch = '*** Begin Patch\n*** Add File: docs/one.md\n+hi\n*** Delete File: /acme/gone.md\n*** Update File: two.md\n@@\n-a\n+b\n*** End Patch';
    hook(COPILOT_WRITE_COMMAND, { timestamp: 1, cwd: '/acme/my work', toolName: 'apply_patch', toolArgs: patch });
    expect(parseFileWrites(recorded())).toEqual([
      { path: '/acme/my work/docs/one.md', kind: 'create' },
      { path: '/acme/gone.md', kind: 'delete' },
      { path: '/acme/my work/two.md', kind: 'update' },
    ]);
  });
});

describe('reading the recorded writes', () => {
  const write = (path: string) => JSON.stringify({ hook_event_name: 'HatstandFileWrite', kind: 'update', file_path: path });

  it('skips the other lines of the activity file, broken lines and relative paths without a folder', () => {
    const text = [
      JSON.stringify({ hook_event_name: 'SessionStart', transcript_path: '/t.jsonl' }),
      write('/acme/a.md'),
      '{"hook_event_name":"HatstandFileWrite","kind":"update","file_path":"/acme/cut',
      write('relative.md'),
      JSON.stringify({ hook_event_name: 'HatstandFileWrite', kind: 'sideways', file_path: '/acme/b.md' }),
      write('/acme/c/../d.md'),
    ].join('\n');
    expect(parseFileWrites(text)).toEqual([
      { path: '/acme/a.md', kind: 'update' },
      { path: '/acme/d.md', kind: 'update' },
    ]);
  });

  it('does not change what the same file says about subagents and the transcript', () => {
    const lines = [
      JSON.stringify({ hook_event_name: 'SessionStart', transcript_path: '/t.jsonl' }),
      JSON.stringify({ hook_event_name: 'PreToolUse', tool_input: { description: 'Look around', subagent_type: 'Explore' } }),
      JSON.stringify({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' }),
      JSON.stringify({ hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'Explore', last_assistant_message: 'Found it' }),
    ];
    const withWrites = [lines[0], write('/acme/a.md'), lines[1], write('/acme/b.md'), lines[2], lines[3], write('/acme/c.md')];
    expect(parseSubagentActivity(withWrites.join('\n'))).toEqual(parseSubagentActivity(lines.join('\n')));
    expect(parseSubagentActivity(withWrites.join('\n'))).toHaveLength(1);
    expect(transcriptPathFrom(withWrites.join('\n'))).toBe('/t.jsonl');
  });
});
