import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { HookState } from '../../shared/api';
import { DEV_COPY_MESSAGE, isDevCopy } from '../dev-copy';
import { buildHookFile, HOOK_MARKER } from './hook-script';

export type HookInstallResult = { path: string; installed: boolean; reason?: string };
export type HookInspection = { path: string; state: HookState; reason?: string };

const EXISTING_HOOK = 'This repository already has a pre-commit hook.';

function hookLocation(repoPath: string): { hooksDir: string; privateHooksDir: string } | null {
  try {
    const output = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-path', 'hooks', '--git-common-dir'], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const [hooks = '', commonDir = ''] = output.trim().split('\n');
    return { hooksDir: resolve(hooks), privateHooksDir: join(resolve(commonDir), 'hooks') };
  } catch {
    return null;
  }
}

export function inspectHook(repoPath: string): HookInspection {
  const location = hookLocation(repoPath);
  if (!location) return { path: repoPath, state: 'not-git', reason: 'This folder is not a git repository.' };
  const { hooksDir, privateHooksDir } = location;
  if (hooksDir !== privateHooksDir) {
    return {
      path: repoPath,
      state: 'managed-elsewhere',
      reason: `Git hooks for this repository are managed in ${hooksDir}. Add the guard there by hand.`,
    };
  }
  const hookPath = join(hooksDir, 'pre-commit');
  if (!existsSync(hookPath)) return { path: repoPath, state: 'missing' };
  return readFileSync(hookPath, 'utf8').includes(HOOK_MARKER)
    ? { path: repoPath, state: 'protected' }
    : { path: repoPath, state: 'existing-hook', reason: EXISTING_HOOK };
}

export function installPreCommitHook(
  repoPath: string,
  nodePath: string,
  guardScript: string,
  keepExistingHook = false,
): HookInstallResult {
  if (isDevCopy()) return { path: repoPath, installed: false, reason: DEV_COPY_MESSAGE };
  const inspection = inspectHook(repoPath);
  const location = hookLocation(repoPath);
  if (inspection.state === 'not-git' || inspection.state === 'managed-elsewhere' || !location) {
    return { path: repoPath, installed: false, reason: inspection.reason };
  }

  const hookPath = join(location.hooksDir, 'pre-commit');
  const previousHook = join(location.hooksDir, 'before-hatstand', 'pre-commit');
  if (inspection.state === 'existing-hook') {
    if (!keepExistingHook) return { path: repoPath, installed: false, reason: EXISTING_HOOK };
    if (existsSync(previousHook)) {
      return { path: repoPath, installed: false, reason: `${previousHook} already exists. Move it, then try again.` };
    }
    mkdirSync(dirname(previousHook), { recursive: true });
    renameSync(hookPath, previousHook);
  }

  mkdirSync(location.hooksDir, { recursive: true });
  writeFileSync(hookPath, buildHookFile(nodePath, guardScript, existsSync(previousHook) ? previousHook : undefined));
  chmodSync(hookPath, 0o755);
  return { path: repoPath, installed: true };
}

export function uninstallPreCommitHook(repoPath: string): boolean {
  if (isDevCopy()) return false;
  const location = hookLocation(repoPath);
  if (!location) return false;
  const hookPath = join(location.hooksDir, 'pre-commit');
  if (!existsSync(hookPath) || !readFileSync(hookPath, 'utf8').includes(HOOK_MARKER)) return false;
  rmSync(hookPath);
  const previousHook = join(location.hooksDir, 'before-hatstand', 'pre-commit');
  if (existsSync(previousHook)) {
    renameSync(previousHook, hookPath);
    rmSync(dirname(previousHook), { recursive: true, force: true });
  }
  return true;
}
