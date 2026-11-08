import type { GitSource } from './schemas';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function gitTokenName(provider: GitSource['provider']): 'GITHUB_TOKEN' | 'GITLAB_TOKEN' {
  return provider === 'github' ? 'GITHUB_TOKEN' : 'GITLAB_TOKEN';
}

export function gitOrigin(source: Pick<GitSource, 'provider' | 'host'>): string {
  if (source.provider === 'github') return 'https://github.com';
  const raw = source.host?.trim() || 'https://gitlab.com';
  const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) {
    throw new Error('Use an https address for your GitLab, so the token is never sent unencrypted.');
  }
  return url.origin;
}

export function tokenPageUrl(source: Pick<GitSource, 'provider' | 'host'>): string {
  if (source.provider === 'github') {
    return 'https://github.com/settings/tokens/new?description=Hatstand&scopes=repo,read:org';
  }
  return `${gitOrigin(source)}/-/user_settings/personal_access_tokens?name=Hatstand&scopes=read_api,write_repository`;
}
