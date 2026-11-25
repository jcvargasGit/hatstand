import type { GitSource } from './schemas';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const SAFE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const SSH_LINK = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/;
const NOT_A_REPOSITORY = 'This is not the link of a repository. It looks like https://github.com/company/repository.';

export type GitHost = Pick<GitSource, 'provider' | 'host'>;

export const GITHUB_HOST: GitHost = { provider: 'github' };

export const isSafePathSegment = (segment: string): boolean => SAFE_SEGMENT.test(segment) && !segment.includes('..');

export function gitTokenName(provider: GitSource['provider']): 'GITHUB_TOKEN' | 'GITLAB_TOKEN' {
  return provider === 'github' ? 'GITHUB_TOKEN' : 'GITLAB_TOKEN';
}

export function gitOrigin(source: GitHost): string {
  if (source.provider === 'github') return 'https://github.com';
  const raw = source.host?.trim() || 'https://gitlab.com';
  const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) {
    throw new Error('Use an https address for your GitLab, so the token is never sent unencrypted.');
  }
  return url.origin;
}

export function tokenPageUrl(source: GitHost): string {
  if (source.provider === 'github') {
    return 'https://github.com/settings/tokens/new?description=Hatstand&scopes=repo,read:org';
  }
  return `${gitOrigin(source)}/-/user_settings/personal_access_tokens?name=Hatstand&scopes=read_api,write_repository`;
}

function linkUrl(link: string): URL {
  const trimmed = link.trim();
  const ssh = SSH_LINK.exec(trimmed);
  const address = ssh ? `https://${ssh[1]}/${ssh[2]}` : trimmed.includes('://') ? trimmed : `https://${trimmed}`;
  try {
    return new URL(address);
  } catch {
    throw new Error(NOT_A_REPOSITORY);
  }
}

/** `git@host:company/repository.git`, where the host can be an alias of the person's SSH settings. */
const SCP_ADDRESS = /^(?:[^@/\s]+@)?[^:/\s]+:(?!\/)(.+)$/;

/**
 * The repository an address points to, as `company/repository`, however it is reached: https, ssh, or an SSH alias.
 * The host is left out on purpose, because an alias does not say which site it stands for.
 * Null when the address is not one of a site, such as a folder on this computer.
 */
export function repoIdentity(address: string): string | null {
  const trimmed = address.trim();
  const scp = trimmed.includes('://') ? null : SCP_ADDRESS.exec(trimmed);
  let path = scp?.[1];
  if (!path) {
    if (!trimmed.includes('://')) return null;
    try {
      path = new URL(trimmed).pathname;
    } catch {
      return null;
    }
  }
  const segments = path.split('/').filter(Boolean);
  if (segments.length < 2) return null;
  return segments.join('/').replace(/\.git$/i, '').toLowerCase();
}

function repoSegments(pathname: string, provider: GitSource['provider']): string[] {
  const segments = pathname.split('/').filter(Boolean);
  if (provider === 'github') return segments.slice(0, 2);
  const marker = segments.indexOf('-');
  return marker === -1 ? segments : segments.slice(0, marker);
}

export function parseRepoLink(link: string, host: GitHost): { cloneUrl: string; name: string } {
  const origin = gitOrigin(host);
  const url = linkUrl(link);
  if (url.username || url.password) throw new Error('Remove the user and password from the link. Hatstand uses the token saved for this client.');
  if (url.origin !== origin) {
    throw new Error(`This client downloads from ${origin}, and this link is on another site, so Hatstand did not use it.`);
  }
  const segments = repoSegments(url.pathname, host.provider).map((segment, index, all) =>
    index === all.length - 1 ? segment.replace(/\.git$/, '') : segment,
  );
  const name = segments.at(-1);
  if (!name || segments.length < 2 || !segments.every(isSafePathSegment)) throw new Error(NOT_A_REPOSITORY);
  return { cloneUrl: `${origin}/${segments.join('/')}.git`, name };
}

/**
 * The web page of a repository, from the address of its origin, reached over https or ssh.
 * Null when the address names no site: a folder on this computer, or an SSH alias, which does not say which site it stands for.
 */
export function repoWebUrl(address: string): string | null {
  const trimmed = address.trim();
  const ssh = SSH_LINK.exec(trimmed);
  const candidate = ssh ? `https://${ssh[1]}/${ssh[2]}` : trimmed;
  if (!/^(https|ssh):\/\//.test(candidate)) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (!url.hostname.includes('.') || segments.length < 2 || !segments.every((segment) => isSafePathSegment(segment))) return null;
  return `https://${url.hostname}/${segments.join('/').replace(/\.git$/i, '')}`;
}
