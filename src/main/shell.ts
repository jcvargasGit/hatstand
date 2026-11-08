import { execFile } from 'node:child_process';
import { accessSync, constants, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RepoCandidate } from '../shared/api';

const PATH_MARKER = '__HATSTAND_PATH__';
const NODE_MARKER = '__HATSTAND_NODE__';
const FALLBACK_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', join(homedir(), '.local/bin')];
const PROBE_TIMEOUT_MS = 8000;
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'vendor', 'dist', 'build']);
const REPO_SCAN_DEPTH = 3;

export type ShellTools = { path: string; nodePath: string };

export function extractBetween(output: string, marker: string): string | null {
  const start = output.indexOf(marker);
  if (start < 0) return null;
  const end = output.indexOf(marker, start + marker.length);
  return end < 0 ? null : output.slice(start + marker.length, end);
}

export function probeShellTools(): Promise<ShellTools> {
  const override = process.env.HATSTAND_PATH;
  if (override) return Promise.resolve({ path: override, nodePath: process.env.HATSTAND_NODE ?? 'node' });
  const shell = process.env.SHELL ?? '/bin/zsh';
  const script = `printf '${PATH_MARKER}%s${PATH_MARKER}${NODE_MARKER}%s${NODE_MARKER}' "$PATH" "$(command -v node)"`;
  return new Promise((resolve) => {
    execFile(shell, ['-ilc', script], { timeout: PROBE_TIMEOUT_MS }, (_error, stdout) => {
      const path = extractBetween(stdout, PATH_MARKER);
      resolve({
        path: path ?? [process.env.PATH, ...FALLBACK_DIRS].filter(Boolean).join(':'),
        nodePath: extractBetween(stdout, NODE_MARKER) ?? 'node',
      });
    });
  });
}

export function findExecutable(command: string, path: string): string | null {
  for (const dir of path.split(':').filter(Boolean)) {
    const candidate = join(dir, command);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

export function scanRepos(root: string, depth = REPO_SCAN_DEPTH): RepoCandidate[] {
  const visit = (dir: string, remaining: number): RepoCandidate[] => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    if (entries.some((entry) => entry.name === '.git')) {
      return [{ name: dir.split('/').pop() ?? dir, path: dir }];
    }
    if (remaining === 0) return [];
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED_DIRS.has(entry.name))
      .flatMap((entry) => visit(join(dir, entry.name), remaining - 1));
  };
  return visit(root, depth).sort((a, b) => a.name.localeCompare(b.name));
}
