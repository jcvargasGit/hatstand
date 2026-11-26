import type { TaskStatus } from './schemas';

/** Each status the way a person says it. */
export const TASK_STATUS_WORDS: Record<TaskStatus, string> = {
  idea: 'backlog',
  todo: 'to do',
  doing: 'in progress',
  done: 'done',
};
