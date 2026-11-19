import { describe, expect, it, vi } from 'vitest';
import { checkKey, parseGitHubExpiry, type Fetcher } from '../../src/main/key-check';

type Route = { status?: number; body?: unknown; headers?: Record<string, string> };

/** A provider that answers by the end of the address. Anything else is a 404. */
function provider(routes: Record<string, Route>) {
  return vi.fn<Fetcher>(async (input) => {
    const url = String(input);
    const route = Object.entries(routes).find(([end]) => url.endsWith(end))?.[1] ?? { status: 404 };
    return new Response(JSON.stringify(route.body ?? {}), { status: route.status ?? 200, headers: route.headers });
  });
}

const sent = (fetcher: ReturnType<typeof provider>, call = 0) => {
  const [url, init] = fetcher.mock.calls[call] ?? [];
  return { url: String(url), headers: (init?.headers ?? {}) as Record<string, string> };
};

describe('the expiry date GitHub sends', () => {
  it.each([
    ['2026-12-01 08:00:00 UTC', '2026-12-01T08:00:00.000Z'],
    ['2026-12-01 08:00:00 -0500', '2026-12-01T13:00:00.000Z'],
    ['2026-12-01 08:00:00 +02:00', '2026-12-01T06:00:00.000Z'],
  ])('reads %s', (header, iso) => {
    expect(parseGitHubExpiry(header)).toBe(iso);
  });

  it.each([null, '', 'never', '2026-13-45 99:00:00 UTC'])('reads no date from %j', (header) => {
    expect(parseGitHubExpiry(header)).toBeUndefined();
  });
});

describe('checking a GitHub token', () => {
  it('is valid, with the expiry GitHub reports', async () => {
    const fetcher = provider({ '/user': { headers: { 'GitHub-Authentication-Token-Expiration': '2026-12-01 08:00:00 UTC' } } });
    expect(await checkKey('GITHUB_TOKEN', { GITHUB_TOKEN: 'ghp_1' }, fetcher)).toEqual({ result: 'valid', expiresAt: '2026-12-01T08:00:00.000Z' });
    expect(sent(fetcher)).toMatchObject({ url: 'https://api.github.com/user', headers: { Authorization: 'Bearer ghp_1' } });
  });

  it('is valid with no expiry when GitHub reports none', async () => {
    expect(await checkKey('GH_TOKEN', { GH_TOKEN: 'ghp_1' }, provider({ '/user': {} }))).toEqual({ result: 'valid', expiresAt: undefined });
  });

  it('is rejected on a 401', async () => {
    expect(await checkKey('GITHUB_TOKEN', { GITHUB_TOKEN: 'ghp_1' }, provider({ '/user': { status: 401 } }))).toEqual({ result: 'rejected' });
  });

  it('says nothing about the key when GitHub fails another way, and never repeats the token', async () => {
    const check = checkKey('GITHUB_TOKEN', { GITHUB_TOKEN: 'ghp_secret' }, provider({ '/user': { status: 503 } }));
    await expect(check).rejects.toThrow(/GitHub answered 503/);
    await expect(check).rejects.not.toThrow(/ghp_secret/);
  });
});

describe('checking a GitLab token', () => {
  const keys = { GITLAB_TOKEN: 'glpat_1', GITLAB_URL: 'https://git.acme.dev/' };

  it('asks the GitLab of the client, and reads the day the token expires', async () => {
    const fetcher = provider({ '/personal_access_tokens/self': { body: { expires_at: '2026-12-01' } } });
    expect(await checkKey('GITLAB_TOKEN', keys, fetcher)).toEqual({ result: 'valid', expiresAt: '2026-12-01T00:00:00.000Z' });
    expect(sent(fetcher)).toEqual({ url: 'https://git.acme.dev/api/v4/personal_access_tokens/self', headers: { 'PRIVATE-TOKEN': 'glpat_1' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('uses gitlab.com when the client has no address', async () => {
    const fetcher = provider({ '/personal_access_tokens/self': { body: { expires_at: null } } });
    expect(await checkKey('GITLAB_TOKEN', { GITLAB_TOKEN: 'glpat_1' }, fetcher)).toEqual({ result: 'valid', expiresAt: undefined });
    expect(sent(fetcher).url).toBe('https://gitlab.com/api/v4/personal_access_tokens/self');
  });

  it('is rejected on a 401', async () => {
    expect(await checkKey('GITLAB_TOKEN', keys, provider({ '/personal_access_tokens/self': { status: 401 } }))).toEqual({ result: 'rejected' });
  });

  it('is valid with no expiry on a GitLab that cannot describe the token', async () => {
    const fetcher = provider({ '/user': {} });
    expect(await checkKey('GITLAB_TOKEN', keys, fetcher)).toEqual({ result: 'valid' });
    expect(sent(fetcher, 1).url).toBe('https://git.acme.dev/api/v4/user');
  });

  it('says nothing about the key when GitLab cannot be read at all', async () => {
    await expect(checkKey('GITLAB_TOKEN', keys, provider({}))).rejects.toThrow(/GitLab answered 404/);
  });
});

describe('checking a Jira token', () => {
  const keys = { JIRA_SITE: 'https://acme.atlassian.net/', JIRA_EMAIL: 'dev@example.com', JIRA_API_TOKEN: 'jira_1' };

  it('is valid, with no expiry, because Jira reports none', async () => {
    const fetcher = provider({ '/rest/api/3/myself': {} });
    expect(await checkKey('JIRA_API_TOKEN', keys, fetcher)).toEqual({ result: 'valid' });
    expect(sent(fetcher).url).toBe('https://acme.atlassian.net/rest/api/3/myself');
    expect(sent(fetcher).headers.Authorization).toBe(`Basic ${Buffer.from('dev@example.com:jira_1').toString('base64')}`);
  });

  it('is rejected on a 401', async () => {
    expect(await checkKey('JIRA_API_TOKEN', keys, provider({ '/rest/api/3/myself': { status: 401 } }))).toEqual({ result: 'rejected' });
  });

  it('needs the site and the email, and asks nobody without them', async () => {
    const fetcher = provider({});
    await expect(checkKey('JIRA_API_TOKEN', { JIRA_API_TOKEN: 'jira_1' }, fetcher)).rejects.toThrow(/JIRA_SITE and JIRA_EMAIL/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('keys with no provider to ask', () => {
  it.each(['ACME_API_TOKEN', 'JIRA_SITE', 'GITLAB_URL'])('refuses %s without reaching the network', async (name) => {
    const fetcher = provider({});
    await expect(checkKey(name, { [name]: 'value' }, fetcher)).rejects.toThrow(/no provider/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses a key the client does not have', async () => {
    await expect(checkKey('GITHUB_TOKEN', {}, provider({}))).rejects.toThrow(/no key called GITHUB_TOKEN/);
  });
});
