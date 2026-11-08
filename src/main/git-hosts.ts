import type { RemoteRepo } from '../shared/api';
import { gitOrigin } from '../shared/git-source';
import type { GitSource } from '../shared/schemas';

export type Fetcher = typeof fetch;

const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const SAFE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

type RawGitHubRepo = {
  name: string;
  description?: string | null;
  clone_url: string;
  archived?: boolean;
  owner?: { login?: string };
};

type RawGitLabRepo = {
  path_with_namespace: string;
  description?: string | null;
  http_url_to_repo: string;
  archived?: boolean;
};

function hostError(name: string, status: number, owner: string): Error {
  if (status === 401) return new Error(`${name} rejected this token. Create a new one and paste it here.`);
  if (status === 403) {
    return new Error(
      `${name} refused access. Check the token's permissions. If the company uses single sign-on, authorize the token for it.`,
    );
  }
  if (status === 404) return new Error(`Could not find ${owner}, or this token cannot see it.`);
  return new Error(`${name} answered ${status}. Try again in a moment.`);
}

async function readPages<T>(
  url: (page: number) => string,
  headers: Record<string, string>,
  fetcher: Fetcher,
  name: string,
  owner: string,
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await fetcher(url(page), { headers });
    if (!response.ok) throw hostError(name, response.status, owner);
    const batch = (await response.json()) as T[];
    items.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return items;
}

export function safeRelativePath(fullPath: string, owner: string): string {
  const prefix = `${owner.toLowerCase()}/`;
  const relative = fullPath.toLowerCase().startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath;
  const segments = relative.split('/');
  if (!segments.every((segment) => SAFE_SEGMENT.test(segment) && !segment.includes('..'))) {
    throw new Error(`The repository name ${fullPath} is not safe to use as a folder.`);
  }
  return segments.join('/');
}

function requireOrigin(cloneUrl: string, origin: string): string {
  if (new URL(cloneUrl).origin !== origin) {
    throw new Error(`The address of a repository points outside ${origin}, so Hatstand did not use it.`);
  }
  return cloneUrl;
}

async function listGitHub(owner: string, token: string, fetcher: Fetcher): Promise<RemoteRepo[]> {
  const api = 'https://api.github.com';
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  const me = await fetcher(`${api}/user`, { headers });
  if (!me.ok) throw hostError('GitHub', me.status, owner);
  const { login } = (await me.json()) as { login: string };

  const paged = (path: string) => (page: number) => `${api}${path}per_page=${PAGE_SIZE}&page=${page}`;
  const read = (path: string) => readPages<RawGitHubRepo>(paged(path), headers, fetcher, 'GitHub', owner);
  const encoded = encodeURIComponent(owner);
  const orgProbe = await fetcher(`${api}/orgs/${encoded}`, { headers });
  let repos: RawGitHubRepo[];
  if (orgProbe.ok) {
    repos = await read(`/orgs/${encoded}/repos?type=all&`);
  } else if (orgProbe.status !== 404) {
    throw hostError('GitHub', orgProbe.status, owner);
  } else if (login.toLowerCase() === owner.toLowerCase()) {
    repos = (await read('/user/repos?affiliation=owner&')).filter(
      (repo) => repo.owner?.login?.toLowerCase() === owner.toLowerCase(),
    );
  } else {
    repos = await read(`/users/${encoded}/repos?`);
  }
  return repos.map((repo) => ({
    path: safeRelativePath(repo.name, owner),
    description: repo.description ?? '',
    cloneUrl: requireOrigin(repo.clone_url, 'https://github.com'),
    archived: repo.archived ?? false,
  }));
}

async function listGitLab(source: GitSource, token: string, fetcher: Fetcher): Promise<RemoteRepo[]> {
  const origin = gitOrigin(source);
  const headers = { 'PRIVATE-TOKEN': token };
  const encoded = encodeURIComponent(source.owner);
  const paged = (path: string) => (page: number) => `${origin}/api/v4${path}per_page=${PAGE_SIZE}&page=${page}`;
  const read = (path: string) => readPages<RawGitLabRepo>(paged(path), headers, fetcher, 'GitLab', source.owner);
  const probe = await fetcher(`${origin}/api/v4/groups/${encoded}?with_projects=false`, { headers });
  if (!probe.ok && probe.status !== 404) throw hostError('GitLab', probe.status, source.owner);
  const repos = probe.ok
    ? await read(`/groups/${encoded}/projects?include_subgroups=true&`)
    : await read(`/users/${encoded}/projects?`);
  return repos.map((repo) => ({
    path: safeRelativePath(repo.path_with_namespace, source.owner),
    description: repo.description ?? '',
    cloneUrl: requireOrigin(repo.http_url_to_repo, origin),
    archived: repo.archived ?? false,
  }));
}

export async function listRemoteRepos(source: GitSource, token: string, fetcher: Fetcher = fetch): Promise<RemoteRepo[]> {
  const repos =
    source.provider === 'github'
      ? await listGitHub(source.owner, token, fetcher)
      : await listGitLab(source, token, fetcher);
  return [...repos].sort((a, b) => a.path.localeCompare(b.path));
}
