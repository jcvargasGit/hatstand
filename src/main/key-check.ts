import { knownKey } from '../shared/known-keys';
import type { KeyCheckOutcome } from './secrets';
import { jiraRequest } from './trackers';

export type Fetcher = typeof fetch;

const REQUEST_TIMEOUT_MS = 15_000;
const GITHUB_EXPIRY_HEADER = 'github-authentication-token-expiration';
const GITHUB_DATE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (UTC|[+-]\d{2}:?\d{2})$/;

/** GitHub writes the date as "2026-12-01 08:00:00 UTC", or with an offset such as "-0500". */
export function parseGitHubExpiry(header: string | null): string | undefined {
  const match = header ? GITHUB_DATE.exec(header.trim()) : null;
  if (!match) return undefined;
  const [, day, time, zone = 'UTC'] = match;
  const offset = zone === 'UTC' ? 'Z' : zone.replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2');
  const when = new Date(`${day}T${time}${offset}`);
  return Number.isNaN(when.getTime()) ? undefined : when.toISOString();
}

/** GitLab gives a day, and the token stops working when that day starts. */
function parseGitLabExpiry(day: unknown): string | undefined {
  if (typeof day !== 'string') return undefined;
  const when = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(when.getTime()) ? undefined : when.toISOString();
}

const ask = (fetcher: Fetcher, url: string, headers: Record<string, string>) =>
  fetcher(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

const unclear = (service: string, status: number) => new Error(`${service} answered ${status}, so Hatstand could not check this key. Try again in a moment.`);

async function checkGitHub(token: string, fetcher: Fetcher): Promise<KeyCheckOutcome> {
  const response = await ask(fetcher, 'https://api.github.com/user', { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' });
  if (response.status === 401) return { result: 'rejected' };
  if (!response.ok) throw unclear('GitHub', response.status);
  return { result: 'valid', expiresAt: parseGitHubExpiry(response.headers.get(GITHUB_EXPIRY_HEADER)) };
}

async function checkGitLab(token: string, address: string | undefined, fetcher: Fetcher): Promise<KeyCheckOutcome> {
  const api = `${(address ?? 'https://gitlab.com').replace(/\/$/, '')}/api/v4`;
  const headers = { 'PRIVATE-TOKEN': token };
  const own = await ask(fetcher, `${api}/personal_access_tokens/self`, headers);
  if (own.status === 401) return { result: 'rejected' };
  if (own.ok) return { result: 'valid', expiresAt: parseGitLabExpiry(((await own.json()) as { expires_at?: unknown }).expires_at) };
  // An older GitLab, or a token of another kind, cannot describe itself. It can still say whether it works.
  const user = await ask(fetcher, `${api}/user`, headers);
  if (user.status === 401) return { result: 'rejected' };
  if (!user.ok) throw unclear('GitLab', user.status);
  return { result: 'valid' };
}

async function checkJira(secrets: Record<string, string>, fetcher: Fetcher): Promise<KeyCheckOutcome> {
  if (!secrets.JIRA_SITE || !secrets.JIRA_EMAIL) throw new Error('Add JIRA_SITE and JIRA_EMAIL first. Jira needs the three keys.');
  const { site, headers } = jiraRequest(secrets);
  const response = await ask(fetcher, `https://${site}/rest/api/3/myself`, headers);
  if (response.status === 401) return { result: 'rejected' };
  if (!response.ok) throw unclear('Jira', response.status);
  return { result: 'valid' };
}

/**
 * Asks the provider of a key whether it still works, and when it expires if the provider says.
 * The token goes only to its own provider. A failure that says nothing about the key is thrown, not recorded.
 */
export async function checkKey(name: string, secrets: Record<string, string>, fetcher: Fetcher): Promise<KeyCheckOutcome> {
  const key = knownKey(name);
  const value = secrets[name];
  if (!value) throw new Error(`This client has no key called ${name}.`);
  if (!key?.isToken) throw new Error('Hatstand knows no provider to ask about this key.');
  if (key.service === 'github') return checkGitHub(value, fetcher);
  if (key.service === 'gitlab') return checkGitLab(value, secrets.GITLAB_URL, fetcher);
  return checkJira(secrets, fetcher);
}
