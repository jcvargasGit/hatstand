import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { feedbackPrompt } from '../../src/main/review-feedback';
import { createReviewService } from '../../src/main/services/reviews';
import type { PullRequest, Task, TaskReview } from '../../src/shared/schemas';
import { DRAFT_IN_THE_WAY } from '../../src/shared/task-summary';
import { makeHome, type TestHome } from '../helpers/home';
import { fakeServiceDeps, makeServiceContext, memorySecrets } from '../helpers/services';

const pull: PullRequest = {
  projectId: 'api',
  repo: 'acme/api',
  number: 7,
  title: 'Fix login',
  url: 'https://github.com/acme/api/pull/7',
  state: 'open',
  draft: false,
  headSha: 'abc',
  ci: 'failing',
  review: 'none',
  conflicts: false,
  failedChecks: [{ name: 'unit tests', jobId: '1' }],
  comments: [{ id: 'c1', author: 'ana', body: 'The token ghp_very_secret leaks in the log.', resolvable: true }],
};
const review: TaskReview = { pulls: [pull], checkedAt: '2026-01-01T00:00:00Z', feedbackKey: 'key-1' };

let home: TestHome;
let task: Task;
beforeEach(() => {
  home = makeHome('hatstand-review-services-');
  home.store.createCompany('Acme', '#112233');
  task = home.store.createTask({ companyId: 'acme', title: 'Fix login' });
});
afterEach(() => home.remove());

function setup(found: TaskReview | undefined = review) {
  const { ctx, stateChanges } = makeServiceContext(home, memorySecrets({ acme: { GITHUB_TOKEN: 'ghp_very_secret' } }));
  const deps = fakeServiceDeps();
  vi.mocked(deps.reviews.get).mockReturnValue(found);
  vi.mocked(deps.reviews.failureLogs).mockResolvedValue(new Map([['api:1', 'expected 1, got 2']]));
  return { reviews: createReviewService(ctx, deps), deps, stateChanges, file: home.paths.feedbackFile('acme', task.id) };
}

describe('giving review feedback to the agent', () => {
  it('checks the pull requests again first, so the feedback is current', async () => {
    const { reviews, deps } = setup();
    await reviews.giveFeedbackToAgent(task.id);
    const [checked] = vi.mocked(deps.reviews.check).mock.invocationCallOrder;
    const [read] = vi.mocked(deps.reviews.get).mock.invocationCallOrder;
    expect(deps.reviews.check).toHaveBeenCalledWith(task.id);
    expect(checked).toBeLessThan(read ?? 0);
  });

  it('writes the failures and comments to a file without the client secrets, and asks the agent to read it', async () => {
    const { reviews, deps, stateChanges, file } = setup();
    await reviews.giveFeedbackToAgent(task.id);
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('# Pull request feedback for Fix login');
    expect(text).toContain('expected 1, got 2');
    expect(text).not.toContain('ghp_very_secret');
    expect(deps.sessions.sendPrompt).toHaveBeenCalledExactlyOnceWith(task.id, feedbackPrompt(file));
    expect(home.store.findTask(task.id).feedbackSent).toBe('key-1');
    expect(stateChanges()).toBe(1);
  });

  it('refuses when there is nothing to fix, and sends nothing', async () => {
    const { reviews, deps, stateChanges, file } = setup({ ...review, feedbackKey: undefined });
    await expect(reviews.giveFeedbackToAgent(task.id)).rejects.toThrow('There are no CI failures or open comments to give the agent.');
    expect(deps.sessions.sendPrompt).not.toHaveBeenCalled();
    expect(existsSync(file)).toBe(false);
    expect(stateChanges()).toBe(0);
  });

  it('does not count the feedback as sent when the agent could not take it, so it can be given again', async () => {
    const { reviews, deps, stateChanges } = setup();
    vi.mocked(deps.sessions.sendPrompt).mockRejectedValue(new Error(DRAFT_IN_THE_WAY));
    await expect(reviews.giveFeedbackToAgent(task.id)).rejects.toThrow(DRAFT_IN_THE_WAY);
    expect(home.store.findTask(task.id).feedbackSent).toBeUndefined();
    expect(stateChanges()).toBe(0);
  });
});

describe('checking pull requests again', () => {
  it('checks one task, or every task', async () => {
    const { reviews, deps, stateChanges } = setup();
    await reviews.refreshReviews(task.id);
    expect(deps.reviews.check).toHaveBeenCalledExactlyOnceWith(task.id);
    expect(deps.reviews.checkAll).not.toHaveBeenCalled();
    await reviews.refreshReviews();
    expect(deps.reviews.checkAll).toHaveBeenCalledOnce();
    expect(stateChanges()).toBe(2);
  });
});
