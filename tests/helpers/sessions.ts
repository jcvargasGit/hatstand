// What a SessionManager test needs besides a mocked node-pty: an agent on the PATH, and no secrets.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';
import type { SecretStore } from '../../src/main/secrets';
import type { FingerprintRefresher } from '../../src/main/session-env';

/** A bin folder with a `claude` that does nothing, so the session finds its agent. The mocked pty never runs it. */
export function fakeAgentBin(root: string): string {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\n');
  chmodSync(join(bin, 'claude'), 0o755);
  return bin;
}

export const noSecrets = { read: () => ({}) } as unknown as SecretStore;

/** Stands in for the commit protection a session refreshes before its agent starts. */
export const fakeProtection = (): FingerprintRefresher => ({ refreshFingerprints: vi.fn() });
