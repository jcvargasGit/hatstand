import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
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

export class SecretStore {
  constructor(
    private readonly paths: DataPaths,
    private readonly cipher: SecretCipher,
  ) {}

  read(companyId: string): Record<string, string> {
    const file = this.paths.secretsFile(companyId);
    if (!existsSync(file)) return {};
    return secretsSchema.parse(JSON.parse(this.cipher.decrypt(readFileSync(file))));
  }

  names(companyId: string): string[] {
    return Object.keys(this.read(companyId)).sort();
  }

  merge(companyId: string, values: Record<string, string>): void {
    this.write(companyId, { ...this.read(companyId), ...values });
  }

  remove(companyId: string, name: string): void {
    const remaining = Object.fromEntries(
      Object.entries(this.read(companyId)).filter(([key]) => key !== name),
    );
    this.write(companyId, remaining);
  }

  private write(companyId: string, values: Record<string, string>): void {
    writePrivateFile(this.paths.secretsFile(companyId), this.cipher.encrypt(JSON.stringify(values)));
  }
}
