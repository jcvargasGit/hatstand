import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBacklogPlanTask } from '../../src/main/backlog-plan';
import { dataPaths, type DataPaths } from '../../src/main/paths';
import type { SecretStore } from '../../src/main/secrets';
import { SessionManager } from '../../src/main/sessions';
import { Store } from '../../src/main/store';
import type { Task } from '../../src/shared/schemas';

const lastSpawn = vi.hoisted(() => ({ env: {} as Record<string, string>, cwd: '' }));

vi.mock('node-pty', () => ({
  spawn: (_file: string, _args: string[], options: { env: Record<string, string>; cwd: string }) => {
    lastSpawn.env = options.env;
    lastSpawn.cwd = options.cwd;
    return { write: () => {}, onData: () => {}, onExit: () => {}, kill: () => {}, resize: () => {} };
  },
}));

let dir: string;
let repo: string;
let paths: DataPaths;
let store: Store;
let sessions: SessionManager;
let inbox: Task[];

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-plan-session-')));
  const bin = join(dir, 'bin');
  repo = join(dir, 'code', 'api');
  mkdirSync(bin);
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\n');
  chmodSync(join(bin, 'claude'), 0o755);
  paths = dataPaths(join(dir, 'home'));
  store = new Store(paths);
  store.saveCompany({ ...store.createCompany('Acme', '#112233'), projects: [{ id: 'api', name: 'api', path: repo }] });
  inbox = ['Add the export', 'Send it by email'].map((title) => store.createTask({ companyId: 'acme', title }, undefined, 'idea'));
  sessions = new SessionManager(paths, store, { read: () => ({}) } as unknown as SecretStore, bin, { onData: () => {}, onChange: () => {}, onNeedsInput: () => {} });
});

afterEach(() => {
  sessions.stopAll();
  rmSync(dir, { recursive: true, force: true });
});

function runCheck(env: Record<string, string>): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn('sh', [paths.checkPlanTool], { env: { PATH: process.env.PATH ?? '', HATSTAND_PLAN_CHECKS: env.HATSTAND_PLAN_CHECKS ?? '' } });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += String(chunk)));
    child.stderr.on('data', (chunk) => (err += String(chunk)));
    child.on('exit', (code) => resolve({ code, out, err }));
  });
}

describe('a session that plans the backlog', () => {
  it('reads the code without a way to copy it, and blocks commits in the originals', async () => {
    const task = createBacklogPlanTask(store, 'acme', inbox.map((item) => item.id));
    const session = await sessions.start(task.id);
    expect(lastSpawn.env.HATSTAND_COPY_REQUESTS).toBeUndefined();
    expect(JSON.parse(lastSpawn.env.HATSTAND_READ_ONLY_REPOS ?? '[]')).toEqual([repo]);
    expect(lastSpawn.env.HATSTAND_PLAN_CHECKS).toBe(paths.planChecksDir(session.id));
    expect(statSync(paths.checkPlanTool).mode & 0o777).toBe(0o700);
    const prompt = readFileSync(paths.promptFile(session.id), 'utf8');
    expect(prompt).toContain('## Backlog to plan');
    expect(prompt).toContain(`Repositories for this task:\n- api (${repo})`);
    expect(store.findTask(task.id).worktrees).toEqual([]);
  });

  it('answers the check the assistant runs, from a missing plan to a valid one', async () => {
    const [a, b] = inbox.map((item) => item.id) as [string, string];
    const task = createBacklogPlanTask(store, 'acme', [a, b]);
    await sessions.start(task.id);
    const env = { ...lastSpawn.env };

    const missing = await runCheck(env);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('There is no plan yet.');

    const file = paths.planFile('acme', task.id);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ version: 1, order: [{ task: 2, dependsOn: [1] }, { task: 1 }] }));
    const wrong = await runCheck(env);
    expect(wrong.code).toBe(1);
    expect(wrong.err).toContain('#2 "Send it by email" depends on #1 "Add the export", so #1 "Add the export" has to come first in the order.');

    writeFileSync(file, JSON.stringify({ version: 1, order: [{ task: 1 }, { task: 2, dependsOn: [1] }] }));
    const valid = await runCheck(env);
    expect(valid.code).toBe(0);
    expect(valid.out).toContain('The plan is valid: 2 in the order');
  }, 20_000);

  it('leaves ordinary tasks as they were', async () => {
    const task = store.createTask({ companyId: 'acme', title: 'Fix it', projectIds: ['api'] });
    await sessions.start(task.id);
    expect(lastSpawn.env.HATSTAND_COPY_REQUESTS).toBeDefined();
    expect(lastSpawn.env.HATSTAND_READ_ONLY_REPOS).toBeDefined();
    expect(lastSpawn.env.HATSTAND_PLAN_CHECKS).toBeUndefined();
  });
});
