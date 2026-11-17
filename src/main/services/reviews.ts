import type { HatstandApi } from '../../shared/api';
import type { ReviewMonitor } from '../review-monitor';
import { buildFeedbackFile, feedbackPrompt } from '../review-feedback';
import type { SessionManager } from '../sessions';
import { writePrivateFile } from '../store';
import type { ServiceContext } from './context';

export type ReviewService = Pick<HatstandApi, 'refreshReviews' | 'giveFeedbackToAgent'>;

export type ReviewServiceDeps = {
  reviews: Pick<ReviewMonitor, 'check' | 'checkAll' | 'get' | 'failureLogs'>;
  sessions: Pick<SessionManager, 'sendPrompt'>;
};

export function createReviewService({ store, paths, secrets, emit }: ServiceContext, { reviews, sessions }: ReviewServiceDeps): ReviewService {
  return {
    refreshReviews: async (taskId) => {
      await (taskId ? reviews.check(taskId) : reviews.checkAll());
      emit('state-changed', null);
    },
    /** Writes the CI failures and open comments of a task to a file, and asks its agent to read it. */
    giveFeedbackToAgent: async (taskId) => {
      await reviews.check(taskId);
      const review = reviews.get(taskId);
      if (!review?.feedbackKey) throw new Error('There are no CI failures or open comments to give the agent.');
      const task = store.findTask(taskId);
      const logs = await reviews.failureLogs(task);
      const file = paths.feedbackFile(task.companyId, taskId);
      writePrivateFile(file, buildFeedbackFile(task, review.pulls, logs, secrets.read(task.companyId)));
      await sessions.sendPrompt(taskId, feedbackPrompt(file));
      store.markFeedbackSent(taskId, review.feedbackKey);
      emit('state-changed', null);
    },
  };
}
