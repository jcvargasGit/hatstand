import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isSensitiveSecret } from '../env';

export const MIN_LINE_LENGTH = 40;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_LINE_HASHES = 200_000;
const SKIPPED_DIRS = new Set(['.git', 'node_modules']);

export type Fingerprints = {
  company: string;
  lineHashes: string[];
  secrets: { name: string; length: number; hash: string }[];
};

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function fingerprintSecrets(secrets: Record<string, string>): Fingerprints['secrets'] {
  return Object.entries(secrets)
    .filter(([name, value]) => isSensitiveSecret(name, value))
    .map(([name, value]) => ({ name, length: value.length, hash: sha256(value) }));
}

export function fingerprintText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= MIN_LINE_LENGTH)
    .map(sha256);
}

export function fingerprintDirs(dirs: string[]): string[] {
  const hashes = new Set<string>();
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (hashes.size >= MAX_LINE_HASHES) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) visit(path);
      } else if (entry.isFile() && statSync(path).size <= MAX_FILE_BYTES) {
        const content = readFileSync(path);
        if (!content.includes(0)) {
          for (const hash of fingerprintText(content.toString('utf8'))) hashes.add(hash);
        }
      }
    }
  };
  dirs.forEach(visit);
  return [...hashes];
}
