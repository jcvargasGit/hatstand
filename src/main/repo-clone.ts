import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CloneProgress, RemoteRepo } from '../shared/api';
import type { GitSource } from '../shared/schemas';
import { credentialHelper } from './git-credentials';

const CLONE_CONCURRENCY = 3;
const CLONE_TOKEN_VARIABLE = 'HATSTAND_GIT_TOKEN';

export type CloneOptions = {
  repos: RemoteRepo[];
  baseDir: string;
  provider: GitSource['provider'];
  token: string;
  path: string;
  onProgress: (progress: CloneProgress, target: string) => void;
};

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

export function cleanGitError(message: string, token: string): string {
  const safe = token ? message.split(token).join('***') : message;
  const lines = safe.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) ?? 'Git could not download this repository.';
}

async function cloneOne(repo: RemoteRepo, target: string, options: CloneOptions): Promise<'cloned' | 'existing'> {
  const env = {
    PATH: options.path,
    HOME: process.env.HOME ?? '',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    [CLONE_TOKEN_VARIABLE]: options.token,
  };
  if (existsSync(join(target, '.git'))) {
    const origin = await runGit(['remote', 'get-url', 'origin'], env, target);
    if (withoutGitSuffix(origin) !== withoutGitSuffix(repo.cloneUrl)) {
      throw new Error(`${target} already holds a different repository.`);
    }
    return 'existing';
  }
  mkdirSync(dirname(target), { recursive: true });
  const helper = credentialHelper(options.provider, CLONE_TOKEN_VARIABLE);
  await runGit(['-c', `credential.helper=${helper}`, 'clone', '--quiet', '--', repo.cloneUrl, target], env);
  return 'cloned';
}

export async function cloneRepos(options: CloneOptions): Promise<CloneProgress[]> {
  const results: CloneProgress[] = [];
  const queue = [...options.repos];
  const worker = async () => {
    for (let repo = queue.shift(); repo; repo = queue.shift()) {
      const target = join(options.baseDir, ...repo.path.split('/'));
      options.onProgress({ path: repo.path, state: 'cloning' }, target);
      let result: CloneProgress;
      try {
        result = { path: repo.path, state: await cloneOne(repo, target, options) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result = { path: repo.path, state: 'failed', error: cleanGitError(message, options.token) };
      }
      results.push(result);
      options.onProgress(result, target);
    }
  };
  await Promise.all(Array.from({ length: CLONE_CONCURRENCY }, worker));
  return results;
}
