import type { TaskSource } from '../../shared/schemas';

export type TrackerIssue = {
  title: string;
  description: string;
  source: TaskSource;
};

export type Fetcher = typeof fetch;

export type Tracker = {
  name: string;
  isConfigured(secrets: Record<string, string>): boolean;
  listAssigned(secrets: Record<string, string>, fetcher: Fetcher): Promise<TrackerIssue[]>;
};

async function readJson(response: Response, name: string): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${name} answered ${response.status}. Check the token and its permissions.`);
  }
  return response.json();
}

type JiraSearch = {
  issues?: { key: string; fields: { summary: string; status?: { name?: string } } }[];
};

export const jira: Tracker = {
  name: 'Jira',
  isConfigured: (secrets) => Boolean(secrets.JIRA_SITE && secrets.JIRA_EMAIL && secrets.JIRA_API_TOKEN),
  async listAssigned(secrets, fetcher) {
    const site = (secrets.JIRA_SITE ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    const auth = Buffer.from(`${secrets.JIRA_EMAIL}:${secrets.JIRA_API_TOKEN}`).toString('base64');
    const params = new URLSearchParams({
      jql: 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC',
      fields: 'summary,status',
      maxResults: '50',
    });
    const response = await fetcher(`https://${site}/rest/api/3/search/jql?${params}`, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    });
    const data = (await readJson(response, 'Jira')) as JiraSearch;
    return (data.issues ?? []).map((issue) => ({
      title: issue.fields.summary,
      description: '',
      source: {
        kind: 'jira',
        key: issue.key,
        url: `https://${site}/browse/${issue.key}`,
        status: issue.fields.status?.name,
      },
    }));
  },
};

type GitHubSearch = {
  items?: { title: string; body?: string | null; html_url: string; number: number; repository_url: string }[];
};

export const github: Tracker = {
  name: 'GitHub',
  isConfigured: (secrets) => Boolean(secrets.GITHUB_TOKEN ?? secrets.GH_TOKEN),
  async listAssigned(secrets, fetcher) {
    const query = new URLSearchParams({
      q: 'assignee:@me is:open is:issue archived:false',
      per_page: '50',
      sort: 'updated',
    });
    const response = await fetcher(`https://api.github.com/search/issues?${query}`, {
      headers: {
        Authorization: `Bearer ${secrets.GITHUB_TOKEN ?? secrets.GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
    });
    const data = (await readJson(response, 'GitHub')) as GitHubSearch;
    return (data.items ?? []).map((item) => ({
      title: item.title,
      description: item.body ?? '',
      source: {
        kind: 'github',
        key: `${item.repository_url.split('/').slice(-2).join('/')}#${item.number}`,
        url: item.html_url,
        status: 'open',
      },
    }));
  },
};

type GitLabIssue = {
  title: string;
  description?: string | null;
  web_url: string;
  references?: { full?: string };
  iid: number;
  state?: string;
};

export const gitlab: Tracker = {
  name: 'GitLab',
  isConfigured: (secrets) => Boolean(secrets.GITLAB_TOKEN),
  async listAssigned(secrets, fetcher) {
    const host = (secrets.GITLAB_URL ?? 'https://gitlab.com').replace(/\/$/, '');
    const response = await fetcher(
      `${host}/api/v4/issues?scope=assigned_to_me&state=opened&per_page=50&order_by=updated_at`,
      { headers: { 'PRIVATE-TOKEN': secrets.GITLAB_TOKEN ?? '' } },
    );
    const data = (await readJson(response, 'GitLab')) as GitLabIssue[];
    return data.map((issue) => ({
      title: issue.title,
      description: issue.description ?? '',
      source: {
        kind: 'gitlab',
        key: issue.references?.full ?? `#${issue.iid}`,
        url: issue.web_url,
        status: issue.state,
      },
    }));
  },
};

export const trackers: Tracker[] = [jira, github, gitlab];
