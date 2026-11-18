// The guide of a task while it has sessions: changing step writes the prompt of the new step into the
// running session, and the steps the agent reports done (through hatstand-step-done) reach the guide.
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import type { TaskGuide } from '../shared/schemas';
import { buildStepPrompt } from './agents/task-prompt';
import type { DataPaths } from './paths';
import { requireSession } from './session-state';
import { parseStepsDone, STEP_DONE_TOOL, STEP_FILE_ENV, withStepsDone } from './step-done-tool';
import { writePrivateFile } from './store';
import type { Store } from './store';
import { taskFocus, taskKnowledgeFolder } from './task-folders';

export const BUSY_FOR_STEP = 'The agent is busy or asking you something. Change step when it is waiting at its prompt.';

/** What the guide needs from the terminals. */
export type GuideTerminals = {
  /**
   * Offers the prompt to the running session of the task: typed at its prompt, or given to the opening
   * prompt still waiting to be typed. Returns false when the task has no running session. Throws, writing
   * nothing, when there is text in the way or the agent is not at its prompt.
   */
  offerToRunningSession(taskId: string, prompt: string | null, busyMessage: string): boolean;
};

/** The guide once the person moves to a step. Moving past a step the person does counts it as done; going back does not undo anything. */
export function guideAfterMove(guide: TaskGuide | undefined, index: number): TaskGuide {
  if (!guide?.steps[index]) throw new Error('This step no longer exists in the guide.');
  const yourStepDone = index > guide.current && guide.steps[guide.current]?.you !== undefined;
  const done = yourStepDone ? withStepsDone(guide.done, [guide.current + 1], guide.steps.length) : guide.done;
  return { ...guide, current: index, done };
}

export class SessionGuides {
  constructor(
    private readonly paths: DataPaths,
    private readonly store: Store,
    private readonly events: { onChange(): void },
    private readonly terminals: GuideTerminals,
  ) {}

  /** Puts hatstand-step-done on the PATH of a session, for its agent to report the steps it finished. */
  prepareSession(sessionId: string): { env: Record<string, string> } {
    writePrivateFile(this.paths.stepDoneTool, STEP_DONE_TOOL);
    chmodSync(this.paths.stepDoneTool, 0o700);
    return { env: { [STEP_FILE_ENV]: this.paths.stepFile(sessionId) } };
  }

  moveStep(taskId: string, index: number): void {
    this.change(taskId, guideAfterMove(this.store.findTask(taskId).guide, index));
  }

  /** Saves the guide. Its step prompt goes to the running session, or waits for the next one to start. */
  change(taskId: string, guide: TaskGuide): void {
    const task = { ...this.store.findTask(taskId), guide };
    const company = this.store.readCompany(task.companyId);
    const prompt = buildStepPrompt(task, taskFocus(company, task), taskKnowledgeFolder(this.paths, company, task));
    if (!this.terminals.offerToRunningSession(taskId, prompt, BUSY_FOR_STEP)) {
      this.store.updateTask(taskId, { guide: { ...guide, promptPending: prompt !== null } });
      return;
    }
    this.store.updateTask(taskId, { guide: { ...guide, promptPending: false } });
    this.events.onChange();
  }

  /** Moves the steps the agent reported into the guide of the task, so they outlive the session. */
  pollStepsDone(sessionId: string): void {
    const file = this.paths.stepFile(sessionId);
    if (!existsSync(file)) return;
    const reading = `${file}.${randomUUID()}.reading`;
    renameSync(file, reading);
    const reported = parseStepsDone(readFileSync(reading, 'utf8'));
    rmSync(reading, { force: true });
    const task = this.store.findTask(requireSession(this.store, sessionId).taskId);
    if (!task.guide || reported.length === 0) return;
    const done = withStepsDone(task.guide.done, reported, task.guide.steps.length);
    if (done.join() === task.guide.done.join()) return;
    this.store.updateTask(task.id, { guide: { ...task.guide, done } });
    this.events.onChange();
  }
}
