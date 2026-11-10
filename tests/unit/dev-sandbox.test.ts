import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAuthStatus } from '../../src/main/agent-status';
import { companySchema, taskSchema } from '../../src/shared/schemas';

const appRoot = resolve(import.meta.dirname, '../..');
const script = join(appRoot, 'scripts', 'dev-sandbox.mjs');

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-sandbox-test-')));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const check = (env: Record<string, string> = {}, ...flags: string[]) => {
  const output = execFileSync(process.execPath, [script, '--check', ...flags], { env: { ...process.env, HATSTAND_SANDBOX_DIR: root, ...env }, encoding: 'utf8' });
  return JSON.parse(output) as { home: string; launches: string; seeded: boolean; electron: string | null; env: Record<string, string> };
};

describe('pnpm dev:sandbox', () => {
  it('seeds a client and a task that Hatstand can read', () => {
    const result = check();
    const companyDir = join(result.home, 'companies', 'acme');
    const company = companySchema.parse(parse(readFileSync(join(companyDir, 'company.yaml'), 'utf8')));
    expect(company.projects[0]?.path).toBe(join(root, 'clients', 'acme', 'acme-api'));
    expect(company.defaultAreaId).toBe('core');

    const [taskFile] = readdirSync(join(companyDir, 'tasks'));
    const task = taskSchema.parse(JSON.parse(readFileSync(join(companyDir, 'tasks', taskFile!), 'utf8')));
    expect(task.projectIds).toEqual(['acme-api']);
    expect(execFileSync('git', ['log', '--oneline'], { cwd: company.projects[0]!.path, encoding: 'utf8' })).toContain('Start the made-up repository');
  });

  it('keeps the data between runs and starts over with --fresh', () => {
    expect(check().seeded).toBe(true);
    expect(check().seeded).toBe(false);
    expect(check({}, '--fresh').seeded).toBe(true);
  });

  it('points Hatstand at the fake agent and a throwaway data folder', () => {
    const { env, home } = check();
    expect(env.HATSTAND_HOME).toBe(home);
    expect(env.HATSTAND_PATH?.startsWith(join(root, 'bin'))).toBe(true);
    expect(home.startsWith(root)).toBe(true);
  });

  it('uses an Electron placed by hand, without the sandbox when its helper is not set up', () => {
    const electron = join(root, 'electron-dist');
    mkdirSync(electron);
    writeFileSync(join(electron, 'electron'), '');
    writeFileSync(join(electron, 'chrome-sandbox'), '');
    const { env } = check({ ELECTRON_OVERRIDE_DIST_PATH: electron });
    expect(env.ELECTRON_OVERRIDE_DIST_PATH).toBe(electron);
    expect(env.NO_SANDBOX).toBe(process.platform === 'linux' ? '1' : undefined);
  });
});

describe('the fake claude', () => {
  const fakeAgent = () => {
    check();
    const agent = join(root, 'bin', 'claude');
    chmodSync(agent, 0o755);
    return agent;
  };

  it('reports that it is signed in', () => {
    const output = execFileSync(fakeAgent(), ['auth', 'status', '--json'], { encoding: 'utf8' });
    expect(parseAuthStatus(output)).toEqual({ signedIn: true, email: 'dev@example.com', plan: 'fake' });
  });

  it('records each launch and reports that it waits for input', () => {
    const log = join(root, 'log');
    const statusFile = join(root, 'status');
    const run = spawnSync(fakeAgent(), ['--session-id', 'abc'], {
      input: '/exit\n',
      encoding: 'utf8',
      env: { ...process.env, HATSTAND_SANDBOX_LOG: log, HATSTAND_STATUS_FILE: statusFile, OTHER_CLIENT_TOKEN: 'secret-value' },
    });
    expect(run.stdout).toContain('fake claude is ready');
    expect(readFileSync(statusFile, 'utf8')).toBe('needs-input');
    const launch = JSON.parse(readFileSync(join(log, 'launches.jsonl'), 'utf8').trim()) as { args: string[]; envNames: string[] };
    expect(launch.args).toEqual(['--session-id', 'abc']);
    expect(launch.envNames).toContain('OTHER_CLIENT_TOKEN');
    expect(JSON.stringify(launch)).not.toContain('secret-value');
  });
});
