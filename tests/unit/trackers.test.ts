import { describe, expect, it, vi } from 'vitest';
import { github, gitlab, jira, type Fetcher, type TrackerIssue } from '../../src/main/trackers';
import { KeyRejectedError } from '../../src/main/key-rejected';
import { planSync, syncTrackers } from '../../src/main/trackers/sync';
import { makeHome } from '../helpers/home';
import { memorySecrets } from '../helpers/services';
import type { Task } from '../../src/shared/schemas';

function fakeFetch(body: unknown, status = 200) {
  return vi.fn<Fetcher>(async () => new Response(JSON.stringify(body), { status }));
}

const JIRA_KEYS = { JIRA_SITE: 'https://acme.atlassian.net/', JIRA_EMAIL: 'dev@example.com', JIRA_API_TOKEN: 'token' };

describe('jira', () => {
  it('needs the site, the email and the token', () => {
    expect(jira.isConfigured(JIRA_KEYS)).toBe(true);
    expect(jira.isConfigured({ JIRA_SITE: 'acme.atlassian.net' })).toBe(false);
  });

  it('maps assigned issues to tasks using the client site', async () => {
    const fetcher = fakeFetch({ issues: [{ key: 'ACME-1', fields: { summary: 'Fix', status: { name: 'To Do' } } }] });
    const [issue] = await jira.listAssigned(JIRA_KEYS, fetcher);
    expect(issue?.source).toEqual({
      kind: 'jira',
      key: 'ACME-1',
      url: 'https://acme.atlassian.net/browse/ACME-1',
      status: 'To Do',
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('https://acme.atlassian.net/rest/api/3/search/jql');
  });

  it('explains a rejected token without showing it', async () => {
    const failure = jira.listAssigned(JIRA_KEYS, fakeFetch({}, 401));
    await expect(failure).rejects.toThrow(/401/);
    await expect(failure).rejects.not.toThrow(/token"/);
  });

  it('says which provider rejected the token, and only on a 401', async () => {
    await expect(jira.listAssigned(JIRA_KEYS, fakeFetch({}, 401))).rejects.toMatchObject({ name: 'KeyRejectedError', service: 'jira' });
    await expect(github.listAssigned({ GITHUB_TOKEN: 't' }, fakeFetch({}, 401))).rejects.toMatchObject({ service: 'github' });
    await expect(gitlab.listAssigned({ GITLAB_TOKEN: 't' }, fakeFetch({}, 401))).rejects.toMatchObject({ service: 'gitlab' });
    await expect(github.listAssigned({ GITHUB_TOKEN: 't' }, fakeFetch({}, 403))).rejects.not.toBeInstanceOf(KeyRejectedError);
  });
});

describe('github', () => {
  it('builds a readable key from the repository', async () => {
    const fetcher = fakeFetch({
      items: [
        {
          title: 'Bug',
          body: null,
          html_url: 'https://github.com/acme/api/issues/7',
          number: 7,
          repository_url: 'https://api.github.com/repos/acme/api',
        },
      ],
    });
    const [issue] = await github.listAssigned({ GITHUB_TOKEN: 't' }, fetcher);
    expect(issue?.source.key).toBe('acme/api#7');
    expect(issue?.description).toBe('');
  });
});

describe('gitlab', () => {
  it('uses a self-hosted address when the client has one', async () => {
    const fetcher = fakeFetch([]);
    await gitlab.listAssigned({ GITLAB_TOKEN: 't', GITLAB_URL: 'https://git.acme.dev/' }, fetcher);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('https://git.acme.dev/api/v4/issues');
  });
});

describe('planSync', () => {
  const issue = (key: string, title: string): TrackerIssue => ({
    title,
    description: '',
    source: { kind: 'jira', key },
  });
  const existing: Task = {
    isolated: false, worktrees: [], checklist: [], priority: 'none', note: '', 
    id: '1',
    companyId: 'acme',
    title: 'Old title',
    description: '',
    projectIds: [],
    status: 'doing',
    source: { kind: 'jira', key: 'ACME-1' },
    createdAt: '',
    updatedAt: '',
  };

  it('creates new issues and refreshes renamed ones without duplicates', () => {
    const plan = planSync([existing], [issue('ACME-1', 'New title'), issue('ACME-2', 'Another')]);
    expect(plan.create.map((item) => item.source.key)).toEqual(['ACME-2']);
    expect(plan.refresh.map((item) => item.task.id)).toEqual(['1']);
  });

  it('does nothing when an issue is unchanged', () => {
    expect(planSync([existing], [issue('ACME-1', 'Old title')])).toEqual({ create: [], refresh: [] });
    expect(planSync([{ ...existing, customTitle: true }], [issue('ACME-1', 'New title')]).refresh).toEqual([]);
  });
});

describe('importing assigned work with a key that stopped working', () => {
  const setup = (values: Record<string, string>) => {
    const home = makeHome('hatstand-sync-');
    home.store.createCompany('Acme', '#112233');
    const keys = memorySecrets({ acme: values });
    const sync = (status: number) => syncTrackers(home.store, 'acme', keys.read('acme'), fakeFetch({ items: [] }, status), keys);
    const check = (name: string) => keys.list('acme').find((key) => key.name === name)?.check?.result;
    return { home, sync, check };
  };

  it('marks the key as rejected on a 401, and still reports the error', async () => {
    const { home, sync, check } = setup({ GITHUB_TOKEN: 't', ACME_API_TOKEN: 'x' });
    const report = await sync(401);
    expect(report.errors).toEqual(['GitHub: GitHub answered 401. Check the token and its permissions.']);
    expect(check('GITHUB_TOKEN')).toBe('rejected');
    expect(check('ACME_API_TOKEN')).toBeUndefined();
    home.remove();
  });

  it('marks GH_TOKEN when that is the key GitHub got', async () => {
    const { home, sync, check } = setup({ GH_TOKEN: 't' });
    await sync(401);
    expect(check('GH_TOKEN')).toBe('rejected');
    home.remove();
  });

  it('marks nothing on another failure, and removes the mark once the import works', async () => {
    const { home, sync, check } = setup({ GITHUB_TOKEN: 't' });
    await sync(500);
    expect(check('GITHUB_TOKEN')).toBeUndefined();
    await sync(401);
    await sync(200);
    expect(check('GITHUB_TOKEN')).toBeUndefined();
    home.remove();
  });
});
