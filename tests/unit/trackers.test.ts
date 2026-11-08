import { describe, expect, it, vi } from 'vitest';
import { github, gitlab, jira, type Fetcher, type TrackerIssue } from '../../src/main/trackers';
import { planSync } from '../../src/main/trackers/sync';
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
