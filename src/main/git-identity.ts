import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { GitIdentityPreview, GitIdentityRepoCheck, GitIdentityStatus } from '../shared/api';
import type { Company, GitIdentity, GitIdentityInput } from '../shared/schemas';
import { writePrivateFile } from './store';
import { defaultClientFolder } from './task-folders';

const OWN_FILE_PREFIX = 'hatstand-';

function git(args: string[], path: string, cwd?: string): Promise<string> {
  return new Promise((done, fail) => {
    execFile('git', args, { cwd, env: { ...process.env, PATH: path }, encoding: 'utf8' }, (error, stdout) => (error ? fail(error) : done(stdout)));
  });
}

const gitValue = (args: string[], path: string, cwd?: string) => git(args, path, cwd).then((value) => value.trim() || null, () => null);

const expand = (folder: string, home: string) => (folder === '~' || folder.startsWith('~/') ? join(home, folder.slice(1)) : resolve(folder));

const withSlash = (folder: string) => (folder.endsWith('/') ? folder : `${folder}/`);

function shorten(path: string, home: string): string {
  return path === home || path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path;
}

const ruleFolder = (folder: string, home: string) => withSlash(shorten(expand(folder, home), home));

const ownFile = (company: Company, home: string) => join(home, '.gitconfig.d', `${OWN_FILE_PREFIX}${company.id}`);

type Rule = { folder: string; file: string };

async function readRules(path: string, home: string): Promise<Rule[]> {
  const output = await git(['config', '--global', '-z', '--get-regexp', '^includeif\\.gitdir:.*\\.path$'], path).catch(() => '');
  return output
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const [key = '', file = ''] = entry.split('\n');
      return { folder: ruleFolder(key.replace(/^includeif\.gitdir:/i, '').replace(/\.path$/i, ''), home), file };
    });
}

function isCovered(repoPath: string, folder: string, home: string): boolean {
  return withSlash(repoPath).startsWith(withSlash(expand(folder, home)));
}

async function checkRepos(company: Company, path: string, home: string): Promise<GitIdentityRepoCheck[]> {
  const identity = company.gitIdentity;
  return Promise.all(
    company.projects.map(async (repo) => {
      const email = await gitValue(['config', 'user.email'], path, repo.path);
      return {
        name: repo.name,
        path: repo.path,
        email,
        covered: identity ? isCovered(repo.path, identity.folder, home) : false,
        matches: identity !== undefined && email === identity.email,
      };
    }),
  );
}

export async function gitIdentityStatus(company: Company, path: string, home = homedir()): Promise<GitIdentityStatus> {
  const [firstRepo] = company.projects;
  const read = (key: string) => gitValue(['config', key], path, firstRepo?.path);
  const [name, email, githubUser, rules] = await Promise.all([read('user.name'), read('user.email'), read('github.user'), readRules(path, home)]);
  const existing = firstRepo ? rules.find((rule) => isCovered(firstRepo.path, rule.folder, home)) : undefined;
  const identity = company.gitIdentity;
  return {
    suggested: {
      name: identity?.name ?? name ?? '',
      email: identity?.email ?? email ?? '',
      githubUser: identity?.githubUser ?? githubUser ?? '',
      folder: identity?.folder ?? existing?.folder ?? ruleFolder(company.rootDir ?? defaultClientFolder(company, home), home),
    },
    repos: await checkRepos(company, path, home),
  };
}

function fileText(identity: GitIdentityInput): string {
  return ['[user]', `    name = ${identity.name}`, `    email = ${identity.email}`, ...(identity.githubUser ? ['[github]', `    user = ${identity.githubUser}`] : [])].join('\n');
}

export async function previewGitIdentity(company: Company, identity: GitIdentityInput, path: string, home = homedir()): Promise<GitIdentityPreview> {
  const folder = ruleFolder(identity.folder, home);
  const file = shorten(ownFile(company, home), home);
  const rule = (await readRules(path, home)).find((item) => item.folder === folder);
  const isForeign = rule !== undefined && shorten(expand(rule.file, home), home) !== file;
  if (isForeign) return { folder, file: rule.file, existingFile: rule.file, addsRule: false, preview: '' };
  const ruleText = rule ? '' : `# Added to your global git config\n[includeIf "gitdir:${folder}"]\n    path = ${file}\n\n`;
  return { folder, file, addsRule: rule === undefined, preview: `${ruleText}# ${file}\n${fileText(identity)}` };
}

function backUpGlobalConfig(backupsDir: string, home: string): void {
  const config = process.env.GIT_CONFIG_GLOBAL ?? join(home, '.gitconfig');
  if (existsSync(config)) writePrivateFile(join(backupsDir, `gitconfig-${Date.now()}`), readFileSync(config));
}

async function writeOwnFile(file: string, identity: GitIdentityInput, path: string): Promise<void> {
  mkdirSync(join(file, '..'), { recursive: true });
  await git(['config', '--file', file, 'user.name', identity.name], path);
  await git(['config', '--file', file, 'user.email', identity.email], path);
  if (identity.githubUser) await git(['config', '--file', file, 'github.user', identity.githubUser], path);
  else await git(['config', '--file', file, '--unset', 'github.user'], path).catch(() => '');
}

export async function applyGitIdentity(company: Company, identity: GitIdentityInput, path: string, backupsDir: string, home = homedir()): Promise<Company> {
  const preview = await previewGitIdentity(company, identity, path, home);
  const saved: Company = { ...company, gitIdentity: { ...identity, folder: preview.folder, appliedAt: new Date().toISOString() } };
  if (preview.existingFile) {
    const wrong = (await checkRepos(saved, path, home)).filter((repo) => repo.covered && !repo.matches);
    if (wrong.length > 0) {
      throw new Error(`${preview.folder} already uses ${preview.existingFile}, and it does not commit as ${identity.email}. Change that file, or write the email it uses.`);
    }
    return saved;
  }
  const file = ownFile(company, home);
  await writeOwnFile(file, identity, path);
  if (preview.addsRule) {
    backUpGlobalConfig(backupsDir, home);
    await git(['config', '--global', '--add', `includeIf.gitdir:${preview.folder}.path`, shorten(file, home)], path);
  }
  return saved;
}

export function identityEnv(identity: GitIdentity | undefined): Record<string, string> {
  if (!identity) return {};
  return {
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email,
  };
}
