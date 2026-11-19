import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BlockedFolder, CloneBlocker, CloneProgress, RemoteRepo } from '../shared/api';
import { repoIdentity } from '../shared/git-source';
import type { GitSource } from '../shared/schemas';
import { credentialHelper } from './git-credentials';

const CLONE_CONCURRENCY = 3;
const CLONE_TOKEN_VARIABLE = 'HATSTAND_GIT_TOKEN';

export type CloneOptions = {
  repos: RemoteRepo[];
  baseDir: string;
  provider: GitSource['provider'];
  token?: string;
  path: string;
  onProgress: (progress: CloneProgress, target: string) => void;
};

/** What stands where a repository would be downloaded. */
export type FolderState = { kind: 'free' } | { kind: 'same' } | { kind: 'blocked'; blocker: CloneBlocker; origin?: string };

class BlockedFolderError extends Error {
  constructor(
    message: string,
    readonly blocker: CloneBlocker,
  ) {
    super(message);
  }
}

function gitEnv(path: string, token?: string): Record<string, string> {
  return {
    PATH: path,
    HOME: process.env.HOME ?? '',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    ...(token ? { [CLONE_TOKEN_VARIABLE]: token } : {}),
  };
}

function runGit(args: string[], env: Record<string, string>, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { env, cwd, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout.trim());
    });
  });
}

function withoutGitSuffix(url: string): string {
  return url.replace(/\/$/, '').replace(/\.git$/, '');
}

/** Whether two addresses reach the same repository. An SSH address and an https one of the same repository do. */
export function isSameRepository(origin: string, cloneUrl: string): boolean {
  const [left, right] = [repoIdentity(origin), repoIdentity(cloneUrl)];
  if (left && right) return left === right;
  return withoutGitSuffix(origin) === withoutGitSuffix(cloneUrl);
}

export function cleanGitError(message: string, token?: string): string {
  const safe = token ? message.split(token).join('***') : message;
  const lines = safe.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) ?? 'Git could not download this repository.';
}

function holdsSomething(target: string): boolean {
  return !statSync(target).isDirectory() || readdirSync(target).length > 0;
}

export async function folderState(target: string, cloneUrl: string, path: string): Promise<FolderState> {
  if (!existsSync(target)) return { kind: 'free' };
  if (!existsSync(join(target, '.git'))) return holdsSomething(target) ? { kind: 'blocked', blocker: 'not-a-repository' } : { kind: 'free' };
  const origin = await runGit(['remote', 'get-url', 'origin'], gitEnv(path), target).catch(() => undefined);
  if (origin && isSameRepository(origin, cloneUrl)) return { kind: 'same' };
  return { kind: 'blocked', blocker: 'other-repository', origin };
}

const countLines = (output: string): number => output.split('\n').filter((line) => line.trim()).length;

/** What the person would lose with a blocked folder: work that is only on this computer. */
export async function describeBlockedFolder(target: string, state: Extract<FolderState, { kind: 'blocked' }>, path: string): Promise<BlockedFolder> {
  if (state.blocker === 'not-a-repository') {
    const entries = statSync(target).isDirectory() ? readdirSync(target).length : 1;
    return { target, blocker: state.blocker, entries, uncommitted: 0, unpushed: 0 };
  }
  const env = gitEnv(path);
  const count = (args: string[]) => runGit(args, env, target).then(countLines, () => 0);
  const [uncommitted, unpushed] = await Promise.all([
    count(['status', '--porcelain']),
    count(['log', '--branches', '--not', '--remotes', '--oneline']),
  ]);
  return { target, blocker: state.blocker, origin: state.origin, entries: 0, uncommitted, unpushed };
}

async function cloneOne(repo: RemoteRepo, target: string, options: CloneOptions): Promise<'cloned' | 'existing'> {
  const state = await folderState(target, repo.cloneUrl, options.path);
  if (state.kind === 'same') return 'existing';
  if (state.kind === 'blocked') {
    const holds = state.blocker === 'other-repository' ? 'already holds a different repository' : 'already exists and is not a repository';
    throw new BlockedFolderError(`${target} ${holds}.`, state.blocker);
  }
  mkdirSync(dirname(target), { recursive: true });
  const credentials = options.token ? ['-c', `credential.helper=${credentialHelper(options.provider, CLONE_TOKEN_VARIABLE)}`] : [];
  await runGit([...credentials, 'clone', '--quiet', '--', repo.cloneUrl, target], gitEnv(options.path, options.token));
  return 'cloned';
}

export function cloneTarget(baseDir: string, repoPath: string): string {
  return join(baseDir, ...repoPath.split('/'));
}

export async function cloneRepos(options: CloneOptions): Promise<CloneProgress[]> {
  const results: CloneProgress[] = [];
  const queue = [...options.repos];
  const worker = async () => {
    for (let repo = queue.shift(); repo; repo = queue.shift()) {
      const target = cloneTarget(options.baseDir, repo.path);
      options.onProgress({ path: repo.path, state: 'cloning' }, target);
      let result: CloneProgress;
      try {
        result = { path: repo.path, state: await cloneOne(repo, target, options) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result = {
          path: repo.path,
          state: 'failed',
          error: cleanGitError(message, options.token),
          ...(error instanceof BlockedFolderError ? { blocker: error.blocker } : {}),
        };
      }
      results.push(result);
      options.onProgress(result, target);
    }
  };
  await Promise.all(Array.from({ length: CLONE_CONCURRENCY }, worker));
  return results;
}
