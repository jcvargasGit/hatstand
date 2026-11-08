import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { BLOCK_HOOK_BYPASS_COMMAND, claudeCode } from '../../src/main/agents/claude-code';
import type { AgentLaunchInput } from '../../src/main/agents/types';
import type { Account, Company, Task } from '../../src/shared/schemas';

const account: Account = { id: 'a', name: 'Claude', type: 'claude-code', label: 'personal' };
const company: Company = {
  id: 'acme',
  name: 'Acme',
  color: '#112233',
  skipPermissions: false,
  origin: 'existing', hasCode: true, confirmedSteps: [],
  protectedPaths: [], links: [],
  subdomains: [],
  projects: [],
  context: { pluginDir: '/skills' },
};
const task: Task = {
  isolated: false, worktrees: [], checklist: [], priority: 'none', note: '', 
  id: 't',
  companyId: 'acme',
  title: 'Fix login',
  description: '',
  projectIds: [],
  status: 'todo',
  createdAt: '',
  updatedAt: '',
};
const input: AgentLaunchInput = {
  account,
  company,
  task,
  sessionId: 'session-1',
  sessionDir: '/run/s',
  notesFile: '/n',
  resume: false,
  promptFile: '/run/prompt.md',
  settingsFile: '/run/settings.json',
  addDirs: ['/knowledge'],
};

describe('claudeCode.buildLaunch', () => {
  it('sends no prompt by itself, so a person presses Enter', () => {
    expect(claudeCode.buildLaunch(input).args[0]).toBe('--session-id');
  });

  it('passes client context through flags', () => {
    const { args } = claudeCode.buildLaunch(input);
    expect(args).toEqual(expect.arrayContaining(['--plugin-dir', '/skills', '--add-dir', '/knowledge']));
    expect(args).toEqual(expect.arrayContaining(['--session-id', 'session-1']));
  });

  it('asks for permission unless the client opted out', () => {
    expect(claudeCode.buildLaunch(input).args).not.toContain('--dangerously-skip-permissions');
    const relaxed = { ...input, company: { ...company, skipPermissions: true } };
    expect(claudeCode.buildLaunch(relaxed).args).toContain('--dangerously-skip-permissions');
  });

  it('resumes without a new prompt', () => {
    const { args } = claudeCode.buildLaunch({ ...input, resume: true });
    expect(args.slice(0, 2)).toEqual(['--resume', 'session-1']);
  });

  it('uses the sign-in folder of the chosen account', () => {
    const second = { ...input, account: { ...account, configDir: '/accounts/work' } };
    expect(claudeCode.buildLaunch(second).env).toEqual({ CLAUDE_CONFIG_DIR: '/accounts/work' });
    expect(claudeCode.buildLaunch(input).env).toEqual({});
  });
});

describe('the hook that stops agents skipping git hooks', () => {
  const run = (command: string) =>
    spawnSync('sh', ['-c', BLOCK_HOOK_BYPASS_COMMAND], {
      input: JSON.stringify({ tool_input: { command } }),
      encoding: 'utf8',
    }).status;

  it.each(['git commit --no-verify -m x', 'git commit -nm x', 'git push --no-verify'])('blocks %s', (command) => {
    expect(run(command)).toBe(2);
  });

  it.each(['git commit -m x', 'git status', 'npm test -- -n 3'])('allows %s', (command) => {
    expect(run(command)).toBe(0);
  });

  it('is available in the shell used by the test', () => {
    expect(execFileSync('sh', ['-c', 'command -v grep'], { encoding: 'utf8' }).trim()).not.toBe('');
  });
});
