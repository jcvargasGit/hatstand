import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataPaths } from '../../src/main/paths';
import type { SecretStore } from '../../src/main/secrets';
import { SessionManager } from '../../src/main/sessions';
import { Store } from '../../src/main/store';

const pty = vi.hoisted(() => ({ output: (_data: string) => {}, exit: () => {} }));

vi.mock('node-pty', () => ({
  spawn: () => ({
    write: () => {},
    onData: (listener: (data: string) => void) => {
      pty.output = listener;
    },
    onExit: (listener: () => void) => {
      pty.exit = listener;
    },
    kill: () => {},
    resize: () => {},
  }),
}));

let dir: string;
let store: Store;
let sessions: SessionManager;
let sent: { data: string; end: number }[];

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-output-')));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\n');
  chmodSync(join(bin, 'claude'), 0o755);
  const paths = dataPaths(join(dir, 'home'));
  store = new Store(paths);
  store.saveCompany({ ...store.createCompany('Acme', '#112233'), rootDir: dir });
  sent = [];
  sessions = new SessionManager(paths, store, { read: () => ({}) } as unknown as SecretStore, bin, {
    onData: (_id, data, end) => sent.push({ data, end }),
    onChange: () => {},
    onNeedsInput: () => {},
  });
});

afterEach(() => {
  sessions.stopAll();
  rmSync(dir, { recursive: true, force: true });
});

describe('the output of a session', () => {
  it('says where each chunk ends, and how far a read reaches, also after the session ends', async () => {
    const task = store.createTask({ companyId: 'acme', title: 'Fix it' });
    const session = await sessions.start(task.id);
    expect(sessions.readOutput(session.id)).toEqual({ text: '', end: 0 });
    pty.output('ready\r\n');
    pty.output('heard: x');
    expect(sent).toEqual([
      { data: 'ready\r\n', end: 7 },
      { data: 'heard: x', end: 15 },
    ]);
    expect(sessions.readOutput(session.id)).toEqual({ text: 'ready\r\nheard: x', end: 15 });
    pty.exit();
    expect(sessions.readOutput(session.id)).toEqual({ text: 'ready\r\nheard: x', end: 15 });
    expect(sessions.readBuffer(session.id)).toBe('ready\r\nheard: x');
  });
});
