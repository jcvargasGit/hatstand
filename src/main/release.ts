import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReleaseStatus } from '../shared/api';
import { releaseStateSchema } from '../shared/schemas';

type ReleaseFolders = { home: string; appRoot: string; path: string };

const INTERRUPTED = 'The update was interrupted. Try again.';

const installDir = () => process.env.HATSTAND_INSTALL_DIR ?? '/Applications';

type ReleaseContext = { platform: NodeJS.Platform; isDevCopy: boolean; isPackaged: boolean };

export const canInstallRelease = ({ platform, isDevCopy, isPackaged }: ReleaseContext) => platform === 'darwin' && isDevCopy && !isPackaged;

function attempt(command: string, args: string[], cwd: string, path: string): string | null {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, PATH: path } }).trim();
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readState(home: string): Pick<ReleaseStatus, 'state' | 'version' | 'message'> {
  const file = join(home, 'release.json');
  if (!existsSync(file)) return { state: 'idle' };
  try {
    const { state, version, message, pid } = releaseStateSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    const unfinished = state === 'building' || state === 'waiting';
    return unfinished && !isAlive(pid) ? { state: 'failed', version, message: INTERRUPTED } : { state, version, message };
  } catch {
    return { state: 'idle' };
  }
}

export function readReleaseStatus({ home, appRoot, path }: ReleaseFolders): ReleaseStatus {
  const plist = join(installDir(), 'Hatstand.app/Contents/Info.plist');
  const outside = attempt('git', ['rev-list', '--count', 'main..HEAD'], appRoot, path);
  return {
    ...readState(home),
    installedVersion: existsSync(plist) ? attempt('plutil', ['-extract', 'CFBundleVersion', 'raw', plist], appRoot, path) : null,
    mainVersion: attempt('git', ['rev-parse', '--short=7', 'main'], appRoot, path),
    commitsOutsideMain: Number(outside ?? 0),
  };
}

export function startRelease({ home, appRoot, path }: ReleaseFolders, nodePath: string): void {
  const log = openSync(join(home, 'release.log'), 'w', 0o600);
  const child = spawn(nodePath, [join(appRoot, 'scripts/release.mjs')], {
    cwd: appRoot,
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, PATH: path, HATSTAND_HOME: home },
  });
  child.unref();
  closeSync(log);
}
