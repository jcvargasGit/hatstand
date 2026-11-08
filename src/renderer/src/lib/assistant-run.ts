import type { AssistantRun } from '../../../shared/schemas';
import { plural } from './text';

export const STOP_AT_NAMES: Record<AssistantRun['stopAt'], string> = {
  commit: 'the commit',
  'pull-request': 'the pull request',
};

export const assistantRunSummary = ({ parallel, stopAt }: AssistantRun): string =>
  `${plural(parallel, 'task', 'tasks')} at a time, stop at ${STOP_AT_NAMES[stopAt]}`;
