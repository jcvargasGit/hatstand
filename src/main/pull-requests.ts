import { z } from 'zod';
import { gitOrigin } from '../shared/git-source';
import { isCopilot } from '../shared/review';
import type { FailedCheck, GitSource, PullRequest, ReviewComment } from '../shared/schemas';

export type Fetcher = typeof fetch;
export type RemoteRef = { host: string; path: string };
export type ReviewHost = { provider: 'github'; token: string } | { provider: 'gitlab'; token: string; origin: string };
export type RepoIdentity = { projectId: string; repo: string };

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_COMMENT_CHARS = 4000;
const MAX_LOG_LINES = 150;
const ESCAPE_SEQUENCES = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

export function parseRemote(url: string): RemoteRef | null {
  const trimmed = url.trim();
  const clean = (path: string) => path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '');
  if (/^[a-z+]+:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return parsed.host ? { host: parsed.host, path: clean(parsed.pathname) } : null;
    } catch {
      return null;
    }
  }
  const scp = trimmed.match(/^(?:[^@/]+@)?([^:/]+):(.+)$/);
  return scp?.[1] && scp[2] ? { host: scp[1], path: clean(scp[2]) } : null;
}

export function reviewHost(remote: RemoteRef, source: GitSource | undefined, secrets: Record<string, string>): ReviewHost | null {
  const githubToken = secrets.GITHUB_TOKEN ?? secrets.GH_TOKEN;
  const ownerMatches = source?.provider === 'github' && remote.path.toLowerCase().startsWith(`${source.owner.toLowerCase()}/`);
  if (githubToken && (remote.host === 'github.com' || ownerMatches)) return { provider: 'github', token: githubToken };
  const origin = gitOrigin(source?.provider === 'gitlab' ? source : { provider: 'gitlab' });
  if (secrets.GITLAB_TOKEN && new URL(origin).host === remote.host) return { provider: 'gitlab', token: secrets.GITLAB_TOKEN, origin };
  return null;
}

const shorten = (text: string) => (text.length > MAX_COMMENT_CHARS ? `${text.slice(0, MAX_COMMENT_CHARS)}…` : text);

function failedResponse(name: string, status: number): Error {
  if (status === 401) return new Error(`${name} rejected this client's token. Paste a new one in the client settings.`);
  if (status === 403) return new Error(`${name} refused access. Check the token's permissions, or try again if the rate limit was reached.`);
  return new Error(`${name} answered ${status}. Hatstand will try again.`);
}

async function readJson(url: string, init: RequestInit, name: string, fetcher: Fetcher): Promise<unknown> {
  const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw failedResponse(name, response.status);
  return response.json();
}

const GITHUB_QUERY = `query($owner: String!, $repo: String!, $branch: String!) {
  repository(owner: $owner, name: $repo) {
    defaultBranchRef { name }
    pullRequests(headRefName: $branch, first: 1, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes {
        number title url state isDraft mergeable reviewDecision headRefOid baseRefName
        reviewThreads(last: 50) { nodes { isResolved path line comments(first: 10) { nodes { databaseId body url author { login } } } } }
        reviews(last: 30) { nodes { databaseId state body url author { login } } }
        reviewRequests(first: 20) { nodes { requestedReviewer { ... on Bot { login } } } }
        comments(last: 30) { nodes { databaseId body url author { __typename login } } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 60) { nodes {
          __typename
          ... on CheckRun { name conclusion detailsUrl title summary }
          ... on StatusContext { context state targetUrl description }
        } } } } } }
      }
    }
  }
}`;

const authorSchema = z.object({ login: z.string(), __typename: z.string().optional() }).nullish();

const githubPullSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.enum(['OPEN', 'MERGED', 'CLOSED']),
  isDraft: z.boolean(),
  mergeable: z.string().nullish(),
  reviewDecision: z.string().nullish(),
  headRefOid: z.string(),
  baseRefName: z.string().nullish(),
  reviewThreads: z.object({
    nodes: z.array(z.object({
      isResolved: z.boolean(),
      path: z.string().nullish(),
      line: z.number().nullish(),
      comments: z.object({ nodes: z.array(z.object({ databaseId: z.number().nullish(), body: z.string(), url: z.string().nullish(), author: authorSchema })) }),
    })),
  }).nullish(),
  reviews: z.object({ nodes: z.array(z.object({ databaseId: z.number().nullish(), state: z.string(), body: z.string().nullish(), url: z.string().nullish(), author: authorSchema })) }).nullish(),
  reviewRequests: z.object({ nodes: z.array(z.object({ requestedReviewer: z.object({ login: z.string().optional() }).nullish() })) }).nullish(),
  comments: z.object({ nodes: z.array(z.object({ databaseId: z.number().nullish(), body: z.string(), url: z.string().nullish(), author: authorSchema })) }).nullish(),
  commits: z.object({
    nodes: z.array(z.object({
      commit: z.object({
        statusCheckRollup: z.object({
          state: z.string(),
          contexts: z.object({
            nodes: z.array(z.object({
              __typename: z.string(),
              name: z.string().nullish(),
              conclusion: z.string().nullish(),
              detailsUrl: z.string().nullish(),
              title: z.string().nullish(),
              summary: z.string().nullish(),
              context: z.string().nullish(),
              state: z.string().nullish(),
              targetUrl: z.string().nullish(),
              description: z.string().nullish(),
            })),
          }),
        }).nullish(),
      }),
    })),
  }).nullish(),
});

const githubResponseSchema = z.object({
  data: z.object({ repository: z.object({ defaultBranchRef: z.object({ name: z.string() }).nullish(), pullRequests: z.object({ nodes: z.array(githubPullSchema) }) }).nullish() }).nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

type GitHubPull = z.infer<typeof githubPullSchema>;

const FAILED_CONCLUSIONS = ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'];
const ROLLUP_CI: Record<string, PullRequest['ci']> = { SUCCESS: 'passing', FAILURE: 'failing', ERROR: 'failing', PENDING: 'running', EXPECTED: 'running' };

function githubFailedChecks(pull: GitHubPull): FailedCheck[] {
  const contexts = pull.commits?.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
  return contexts.flatMap((context): FailedCheck[] => {
    if (context.__typename === 'CheckRun' && FAILED_CONCLUSIONS.includes(context.conclusion ?? '')) {
      const jobId = context.detailsUrl?.match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+\/job\/(\d+)/)?.[1];
      return [{ name: context.name ?? 'Check', url: context.detailsUrl ?? undefined, detail: [context.title, context.summary].filter(Boolean).join('\n') || undefined, jobId }];
    }
    if (context.__typename === 'StatusContext' && ['FAILURE', 'ERROR'].includes(context.state ?? '')) {
      return [{ name: context.context ?? 'Status', url: context.targetUrl ?? undefined, detail: context.description ?? undefined }];
    }
    return [];
  });
}

function githubReviewState(pull: GitHubPull): PullRequest['review'] {
  if (pull.reviewDecision === 'APPROVED') return 'approved';
  if (pull.reviewDecision === 'CHANGES_REQUESTED') return 'changes-requested';
  const latest = new Map<string, string>();
  for (const review of pull.reviews?.nodes ?? []) {
    if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) latest.set(review.author?.login ?? 'someone', review.state);
  }
  const states = [...latest.values()];
  if (states.includes('CHANGES_REQUESTED')) return 'changes-requested';
  return states.includes('APPROVED') ? 'approved' : 'none';
}

function githubCopilot(pull: GitHubPull): PullRequest['copilot'] {
  if ((pull.reviewRequests?.nodes ?? []).some((request) => isCopilot(request.requestedReviewer?.login ?? ''))) return 'pending';
  return (pull.reviews?.nodes ?? []).some((review) => isCopilot(review.author?.login ?? '')) ? 'reviewed' : undefined;
}

function githubComments(pull: GitHubPull): ReviewComment[] {
  const threads = (pull.reviewThreads?.nodes ?? [])
    .filter((thread) => !thread.isResolved)
    .flatMap((thread) =>
      thread.comments.nodes.map((comment, index) => ({
        id: `thread-${comment.databaseId ?? `${thread.path}-${index}`}`,
        author: comment.author?.login ?? 'someone',
        body: shorten(comment.body),
        url: comment.url ?? undefined,
        file: thread.path ?? undefined,
        line: thread.line ?? undefined,
        resolvable: true,
      })),
    );
  const reviews = (pull.reviews?.nodes ?? [])
    .filter((review) => review.state === 'CHANGES_REQUESTED' && review.body?.trim())
    .map((review) => ({ id: `review-${review.databaseId}`, author: review.author?.login ?? 'someone', body: shorten(review.body ?? ''), url: review.url ?? undefined }));
  const general = (pull.comments?.nodes ?? [])
    .filter((comment) => comment.author?.__typename !== 'Bot')
    .map((comment) => ({ id: `comment-${comment.databaseId}`, author: comment.author?.login ?? 'someone', body: shorten(comment.body), url: comment.url ?? undefined }));
  return [...threads, ...reviews, ...general];
}

export function normalizeGitHubPull(pull: GitHubPull, identity: RepoIdentity, defaultBranch?: string): PullRequest {
  const states = { OPEN: 'open', MERGED: 'merged', CLOSED: 'closed' } as const;
  const rollup = pull.commits?.nodes[0]?.commit.statusCheckRollup?.state;
  return {
    ...identity,
    number: pull.number,
    title: pull.title,
    url: pull.url,
    state: states[pull.state],
    draft: pull.isDraft,
    headSha: pull.headRefOid,
    ci: rollup ? (ROLLUP_CI[rollup] ?? 'none') : 'none',
    review: githubReviewState(pull),
    reviewRequired: pull.reviewDecision === 'REVIEW_REQUIRED',
    copilot: githubCopilot(pull),
    conflicts: pull.mergeable === 'CONFLICTING',
    intoMain: pull.baseRefName && defaultBranch ? pull.baseRefName === defaultBranch : undefined,
    failedChecks: githubFailedChecks(pull),
    comments: githubComments(pull),
  };
}

async function readGitHubPull(remote: RemoteRef, branch: string, token: string, identity: RepoIdentity, fetcher: Fetcher): Promise<PullRequest | null> {
  const [owner, repo] = remote.path.split('/');
  const body = await readJson(
    'https://api.github.com/graphql',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: GITHUB_QUERY, variables: { owner, repo, branch } }),
    },
    'GitHub',
    fetcher,
  );
  const parsed = githubResponseSchema.parse(body);
  const repository = parsed.data?.repository;
  const pulls = repository?.pullRequests.nodes;
  if (!pulls) throw new Error(parsed.errors?.[0]?.message ?? `GitHub did not find ${remote.path} with this client's token.`);
  return pulls[0] ? normalizeGitHubPull(pulls[0], identity, repository?.defaultBranchRef?.name) : null;
}

const gitlabPullSchema = z.object({
  iid: z.number(),
  title: z.string(),
  web_url: z.string(),
  state: z.string(),
  draft: z.boolean().optional(),
  sha: z.string().nullish(),
  target_branch: z.string().nullish(),
  has_conflicts: z.boolean().optional(),
  detailed_merge_status: z.string().nullish(),
  head_pipeline: z.object({ id: z.number(), status: z.string() }).nullish(),
});

const gitlabDiscussionsSchema = z.array(z.object({
  notes: z.array(z.object({
    id: z.number(),
    body: z.string(),
    system: z.boolean().optional(),
    resolvable: z.boolean().optional(),
    resolved: z.boolean().optional(),
    author: z.object({ username: z.string() }).nullish(),
    position: z.object({ new_path: z.string().nullish(), new_line: z.number().nullish() }).nullish(),
  })),
}));

const gitlabJobsSchema = z.array(z.object({ id: z.number(), name: z.string(), web_url: z.string().nullish(), failure_reason: z.string().nullish() }));

const PIPELINE_CI: Record<string, PullRequest['ci']> = {
  success: 'passing',
  failed: 'failing',
  canceled: 'failing',
  running: 'running',
  pending: 'running',
  created: 'running',
  preparing: 'running',
  waiting_for_resource: 'running',
  scheduled: 'running',
  manual: 'running',
};

async function readGitLabPull(remote: RemoteRef, branch: string, host: Extract<ReviewHost, { provider: 'gitlab' }>, identity: RepoIdentity, fetcher: Fetcher): Promise<PullRequest | null> {
  const project = `${host.origin}/api/v4/projects/${encodeURIComponent(remote.path)}`;
  const read = (path: string) => readJson(`${project}${path}`, { headers: { 'PRIVATE-TOKEN': host.token } }, 'GitLab', fetcher);
  const found = z.array(gitlabPullSchema).parse(await read(`/merge_requests?source_branch=${encodeURIComponent(branch)}&state=all&order_by=created_at&sort=desc&per_page=1`));
  const summary = found[0];
  if (!summary) return null;
  const pull = gitlabPullSchema.parse(await read(`/merge_requests/${summary.iid}`));
  const approvals = await read(`/merge_requests/${pull.iid}/approvals`).then((value) => z.object({ approved: z.boolean().optional(), approvals_left: z.number().optional() }).parse(value)).catch(() => ({ approved: false, approvals_left: undefined }));
  const discussions = gitlabDiscussionsSchema.parse(await read(`/merge_requests/${pull.iid}/discussions?per_page=100`));
  const comments = discussions.flatMap((discussion) =>
    discussion.notes
      .filter((note) => !note.system && !(note.resolvable && note.resolved))
      .map((note) => ({
        id: `note-${note.id}`,
        author: note.author?.username ?? 'someone',
        body: shorten(note.body),
        url: `${pull.web_url}#note_${note.id}`,
        file: note.position?.new_path ?? undefined,
        line: note.position?.new_line ?? undefined,
        resolvable: note.resolvable ?? false,
      })),
  );
  const ci = pull.head_pipeline ? (PIPELINE_CI[pull.head_pipeline.status] ?? 'none') : 'none';
  const jobs = ci === 'failing' && pull.head_pipeline ? gitlabJobsSchema.parse(await read(`/pipelines/${pull.head_pipeline.id}/jobs?scope[]=failed&per_page=50`)) : [];
  const defaultBranch = pull.state === 'merged' ? await read('').then((value) => z.object({ default_branch: z.string().nullish() }).parse(value).default_branch).catch(() => undefined) : undefined;
  const states: Record<string, PullRequest['state']> = { opened: 'open', merged: 'merged', closed: 'closed', locked: 'closed' };
  return {
    ...identity,
    number: pull.iid,
    title: pull.title,
    url: pull.web_url,
    state: states[pull.state] ?? 'closed',
    draft: pull.draft ?? false,
    headSha: pull.sha ?? '',
    ci,
    review: pull.detailed_merge_status === 'requested_changes' ? 'changes-requested' : approvals.approved ? 'approved' : 'none',
    reviewRequired: approvals.approvals_left === undefined ? undefined : approvals.approvals_left > 0,
    conflicts: pull.has_conflicts ?? false,
    intoMain: pull.target_branch && defaultBranch ? pull.target_branch === defaultBranch : undefined,
    failedChecks: jobs.map((job) => ({ name: job.name, url: job.web_url ?? undefined, detail: job.failure_reason ?? undefined, jobId: String(job.id) })),
    comments,
  };
}

export async function readPull(remote: RemoteRef, branch: string, host: ReviewHost, identity: RepoIdentity, fetcher: Fetcher = fetch): Promise<PullRequest | null> {
  return host.provider === 'github' ? readGitHubPull(remote, branch, host.token, identity, fetcher) : readGitLabPull(remote, branch, host, identity, fetcher);
}

export function logTail(text: string): string {
  return text.replace(ESCAPE_SEQUENCES, '').split('\n').slice(-MAX_LOG_LINES).join('\n').trim();
}

export async function readFailureLog(remote: RemoteRef, host: ReviewHost, jobId: string, fetcher: Fetcher = fetch): Promise<string | null> {
  const [url, headers] =
    host.provider === 'github'
      ? [`https://api.github.com/repos/${remote.path}/actions/jobs/${jobId}/logs`, { Authorization: `Bearer ${host.token}` }]
      : [`${host.origin}/api/v4/projects/${encodeURIComponent(remote.path)}/jobs/${jobId}/trace`, { 'PRIVATE-TOKEN': host.token }];
  try {
    const response = await fetcher(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return response.ok ? logTail(await response.text()) : null;
  } catch {
    return null;
  }
}
