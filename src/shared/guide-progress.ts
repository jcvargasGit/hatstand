import type { TaskGuide } from './schemas';

/** Whether step `index` (from 0) is finished: the agent reported it, or the person moved past a step they do themselves. */
export const isGuideStepDone = (guide: TaskGuide, index: number): boolean => guide.done.includes(index + 1);

/** The current step can be left: it is finished, or it has nothing for the agent to do. */
export function canLeaveCurrentStep(guide: TaskGuide): boolean {
  const step = guide.steps[guide.current];
  const waitsForAgent = Boolean(step?.prompt) && !step?.you;
  return !waitsForAgent || isGuideStepDone(guide, guide.current);
}

/** The step that Next step opens: the first one after the current step that is not finished yet, or null when none is left. */
export function nextOpenStep(guide: TaskGuide): number | null {
  for (let index = guide.current + 1; index < guide.steps.length; index += 1) {
    if (!isGuideStepDone(guide, index)) return index;
  }
  return null;
}

/** Steps the agent finished ahead of the current one, such as while talking with the person. */
export const stepsDoneAhead = (guide: TaskGuide): number[] => guide.done.filter((step) => step > guide.current + 1);

export const allStepsDone = (guide: TaskGuide): boolean => guide.steps.every((_step, index) => isGuideStepDone(guide, index));
