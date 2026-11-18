import { existsSync, readFileSync } from 'node:fs';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { keyDetailsFileSchema, type KeyCheck, type KeyDetails, type KeyInfo } from '../shared/schemas';
import type { DataPaths } from './paths';
import { writePrivateFile } from './store';

export type SecretCipher = {
  encrypt(plain: string): Buffer;
  decrypt(sealed: Buffer): string;
};

type StorageFacts = {
  platform: NodeJS.Platform;
  encryptionAvailable: boolean;
  linuxBackend?: string;
};

// On Linux without a secret store, Electron reports encryption as available and uses a fixed password.
const UNSAFE_LINUX_BACKENDS = new Set(['basic_text', 'unknown']);

export function canEncryptSafely({ platform, encryptionAvailable, linuxBackend }: StorageFacts): boolean {
  if (!encryptionAvailable) return false;
  return platform !== 'linux' || !UNSAFE_LINUX_BACKENDS.has(linuxBackend ?? 'unknown');
}

const secretsSchema = z.record(z.string(), z.string());

type AllDetails = Record<string, KeyDetails>;

/** What a check found, before the store adds when it happened. */
export type KeyCheckOutcome = Pick<KeyCheck, 'result' | 'expiresAt'>;

/**
 * The keys of each client. Values live in secrets.enc, sealed with the system keychain. What Hatstand knows
 * about a key that is not secret (when it was saved, a note, the last check) lives next to it in keys.yaml.
 */
export class SecretStore {
  constructor(
    private readonly paths: DataPaths,
    private readonly cipher: SecretCipher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  read(companyId: string): Record<string, string> {
    const file = this.paths.secretsFile(companyId);
    if (!existsSync(file)) return {};
    return secretsSchema.parse(JSON.parse(this.cipher.decrypt(readFileSync(file))));
  }

  names(companyId: string): string[] {
    return Object.keys(this.read(companyId)).sort();
  }

  list(companyId: string): KeyInfo[] {
    const details = this.readDetails(companyId);
    return this.names(companyId).map((name) => ({ ...details[name], name }));
  }

  /** Saves values. A key that is new or changed starts over: it has a new date and no check. */
  merge(companyId: string, values: Record<string, string>): void {
    const before = this.read(companyId);
    this.write(companyId, { ...before, ...values });
    const changed = Object.keys(values).filter((name) => before[name] !== values[name]);
    if (changed.length === 0) return;
    const details = this.readDetails(companyId);
    const savedAt = this.now().toISOString();
    const fresh = Object.fromEntries(changed.map((name) => [name, { ...withoutCheck(details[name]), savedAt }]));
    this.writeDetails(companyId, { ...details, ...fresh });
  }

  remove(companyId: string, name: string): void {
    this.write(companyId, without(this.read(companyId), name));
    const details = this.readDetails(companyId);
    if (name in details) this.writeDetails(companyId, without(details, name));
  }

  /** Remembers what the provider said about a key. Says whether that is news, and writes nothing when it is not. */
  recordCheck(companyId: string, name: string, outcome: KeyCheckOutcome): boolean {
    if (!this.names(companyId).includes(name)) return false;
    const details = this.readDetails(companyId);
    const last = details[name]?.check;
    const isNews = last?.result !== outcome.result || last.expiresAt !== outcome.expiresAt;
    const check: KeyCheck = { at: this.now().toISOString(), result: outcome.result, ...(outcome.expiresAt ? { expiresAt: outcome.expiresAt } : {}) };
    if (isNews) this.writeDetails(companyId, { ...details, [name]: { ...details[name], check } });
    return isNews;
  }

  /** Forgets that a key was rejected, once the provider accepts it again. Says whether there was something to forget. */
  clearRejection(companyId: string, name: string): boolean {
    const details = this.readDetails(companyId);
    if (details[name]?.check?.result !== 'rejected') return false;
    this.writeDetails(companyId, { ...details, [name]: withoutCheck(details[name]) });
    return true;
  }

  setNote(companyId: string, name: string, note: string): void {
    if (!this.names(companyId).includes(name)) throw new Error(`This client has no key called ${name}.`);
    const details = this.readDetails(companyId);
    const { note: _old, ...rest } = details[name] ?? {};
    const text = note.trim();
    this.writeDetails(companyId, { ...details, [name]: text ? { ...rest, note: text } : rest });
  }

  private write(companyId: string, values: Record<string, string>): void {
    writePrivateFile(this.paths.secretsFile(companyId), this.cipher.encrypt(JSON.stringify(values)));
  }

  /** A missing or damaged file means Hatstand knows nothing extra about the keys. The keys still work. */
  private readDetails(companyId: string): AllDetails {
    const file = this.paths.keyDetailsFile(companyId);
    if (!existsSync(file)) return {};
    try {
      return keyDetailsFileSchema.parse(parse(readFileSync(file, 'utf8')) ?? {}).keys;
    } catch {
      return {};
    }
  }

  private writeDetails(companyId: string, keys: AllDetails): void {
    writePrivateFile(this.paths.keyDetailsFile(companyId), stringify(keyDetailsFileSchema.parse({ keys })));
  }
}

function without<T>(all: Record<string, T>, name: string): Record<string, T> {
  return Object.fromEntries(Object.entries(all).filter(([key]) => key !== name));
}

function withoutCheck(details: KeyDetails | undefined): KeyDetails {
  const { check: _check, ...rest } = details ?? {};
  return rest;
}
