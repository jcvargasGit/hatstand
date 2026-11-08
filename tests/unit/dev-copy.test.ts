import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installPreCommitHook, uninstallPreCommitHook } from '../../src/main/guard/install';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hatstand-dev-copy-'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('copying real data for development', () => {
  const script = resolve(__dirname, '../../scripts/dev-sync.mjs');
  const sync = () => execFileSync(process.execPath, [script, '--force'], { encoding: 'utf8', env: { HOME: root, PATH: process.env.PATH } });
  const realTask = () => join(root, '.hatstand/companies/acme/tasks/t1.json');
  const copiedTask = () => join(root, '.hatstand-dev/companies/acme/tasks/t1.json');
  const worktree = { projectId: 'api', path: '/real/worktree', branch: 'hatstand/t1' };

  beforeEach(() => {
    mkdirSync(join(root, '.hatstand/companies/acme/tasks'), { recursive: true });
    mkdirSync(join(root, '.hatstand/sessions'));
    mkdirSync(join(root, '.hatstand/worktrees/acme/t1'), { recursive: true });
    writeFileSync(join(root, '.hatstand/preferences.yaml'), 'stayAwake: off\n');
    writeFileSync(join(root, '.hatstand/companies/acme/company.yaml'), 'id: acme\n');
    writeFileSync(join(root, '.hatstand/companies/acme/secrets.enc'), 'sealed');
    writeFileSync(join(root, '.hatstand/sessions/s1.json'), '{}');
    writeFileSync(realTask(), JSON.stringify({ id: 't1', isolated: true, worktrees: [worktree] }));
  });

  it('brings clients, keys and tasks', () => {
    expect(sync()).toContain('Copied 1 clients and 1 tasks');
    expect(readFileSync(join(root, '.hatstand-dev/companies/acme/company.yaml'), 'utf8')).toBe('id: acme\n');
    expect(readFileSync(join(root, '.hatstand-dev/companies/acme/secrets.enc'), 'utf8')).toBe('sealed');
    expect(existsSync(join(root, '.hatstand-dev/preferences.yaml'))).toBe(true);
  });

  it('leaves out what could reach real sessions or worktrees', () => {
    sync();
    expect(JSON.parse(readFileSync(copiedTask(), 'utf8'))).toEqual({ id: 't1', isolated: true, worktrees: [] });
    expect(existsSync(join(root, '.hatstand-dev/sessions'))).toBe(false);
    expect(existsSync(join(root, '.hatstand-dev/worktrees'))).toBe(false);
  });

  it('never changes the real data', () => {
    sync();
    expect(JSON.parse(readFileSync(realTask(), 'utf8')).worktrees).toEqual([worktree]);
    expect(existsSync(join(root, '.hatstand/sessions/s1.json'))).toBe(true);
    expect(existsSync(join(root, '.hatstand/worktrees/acme/t1'))).toBe(true);
  });

  it('replaces the previous copy and removes its old sessions, keeping the window settings', () => {
    mkdirSync(join(root, '.hatstand-dev/companies/old'), { recursive: true });
    mkdirSync(join(root, '.hatstand-dev/sessions'));
    mkdirSync(join(root, '.hatstand-dev/electron'));
    sync();
    expect(existsSync(join(root, '.hatstand-dev/companies/old'))).toBe(false);
    expect(existsSync(join(root, '.hatstand-dev/sessions'))).toBe(false);
    expect(existsSync(join(root, '.hatstand-dev/electron'))).toBe(true);
  });

  it('refuses while a development copy is open', () => {
    const open = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)', 'electron-vite.js', 'dev'], { stdio: 'ignore' });
    try {
      const run = () => execFileSync(process.execPath, [script], { stdio: 'pipe', env: { HOME: root, PATH: process.env.PATH } });
      expect(run).toThrow(/Close it/);
      expect(existsSync(join(root, '.hatstand-dev'))).toBe(false);
    } finally {
      open.kill();
    }
  });

  it('says so when there is nothing to copy', () => {
    rmSync(join(root, '.hatstand'), { recursive: true });
    expect(sync).toThrow();
    expect(existsSync(join(root, '.hatstand-dev'))).toBe(false);
  });
});

describe('protection hooks in the development copy', () => {
  const hook = () => join(root, 'repo/.git/hooks/pre-commit');

  beforeEach(() => {
    execFileSync('git', ['init', '-q', join(root, 'repo')]);
  });

  it('does not add a hook to a real repository', () => {
    vi.stubEnv('HATSTAND_DEV_COPY', '1');
    const result = installPreCommitHook(join(root, 'repo'), process.execPath, '/guard.cjs');
    expect(result.installed).toBe(false);
    expect(result.reason).toContain('development copy');
    expect(existsSync(hook())).toBe(false);
  });

  it('does not remove the hook that protects a real repository', () => {
    installPreCommitHook(join(root, 'repo'), process.execPath, '/guard.cjs');
    vi.stubEnv('HATSTAND_DEV_COPY', '1');
    expect(uninstallPreCommitHook(join(root, 'repo'))).toBe(false);
    expect(existsSync(hook())).toBe(true);
  });
});
