import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { BUSY_FOR_STEP, CONTINUE_BY_ITSELF, guideAfterMove, SessionGuides, type GuideTerminals } from '../../src/main/session-guide';
import { STEP_DONE_TOOL } from '../../src/main/step-done-tool';
import { writePrivateFile } from '../../src/main/store';
import { autoContinueStep } from '../../src/shared/guide-progress';
import type { SessionState, TaskGuide } from '../../src/shared/schemas';
import { DRAFT_IN_THE_WAY } from '../../src/shared/task-summary';
import { makeHome, type TestHome } from '../helpers/home';

const guide: TaskGuide = {
  playbookId: 'x',
  name: 'Check',
  current: 0,
  promptPending: false,
  done: [],
  steps: [{ name: 'Read', prompt: 'Read it.' }, { name: 'Fix', prompt: 'Fix it.' }, { name: 'Ask', you: 'Ask them.' }],
};

let home: TestHome;
let taskId: string;
let onChange: Mock<() => void>;
let offer: Mock<GuideTerminals['offerToRunningSession']>;
let send: Mock<GuideTerminals['sendToRunningSession']>;
let guides: SessionGuides;

beforeEach(() => {
  home = makeHome('hatstand-session-guide-');
  home.store.createCompany('Acme', '#112233');
  taskId = home.store.createTask({ companyId: 'acme', title: 'Fix it' }).id;
  home.store.updateTask(taskId, { guide });
  onChange = vi.fn<() => void>();
  offer = vi.fn<GuideTerminals['offerToRunningSession']>(() => false);
  send = vi.fn<GuideTerminals['sendToRunningSession']>();
  guides = new SessionGuides(home.paths, home.store, { onChange }, { offerToRunningSession: offer, sendToRunningSession: send });
});
afterEach(() => home.remove());

const savedGuide = () => home.store.findTask(taskId).guide;

describe('moving to a step', () => {
  it('goes to the step, and keeps what was done', () => {
    expect(guideAfterMove({ ...guide, done: [1] }, 1)).toEqual({ ...guide, current: 1, done: [1] });
  });

  it('counts a step the person does as done once they move past it', () => {
    expect(guideAfterMove({ ...guide, current: 2, steps: [...guide.steps, { name: 'Ship', prompt: 'Ship it.' }] }, 3).done).toEqual([3]);
  });

  it('undoes nothing when going back', () => {
    expect(guideAfterMove({ ...guide, current: 2, done: [1] }, 0).done).toEqual([1]);
  });

  it('refuses a step the guide does not have, or a task without a guide', () => {
    expect(() => guideAfterMove(guide, 3)).toThrow('This step no longer exists in the guide.');
    expect(() => guideAfterMove(undefined, 0)).toThrow('This step no longer exists in the guide.');
  });
});

describe('changing the step of a task', () => {
  it('keeps the prompt for the next session when none is running', () => {
    guides.moveStep(taskId, 1);
    expect(offer).toHaveBeenCalledExactlyOnceWith(taskId, expect.stringContaining('Step 2 of 3, Fix'), BUSY_FOR_STEP);
    expect(savedGuide()).toMatchObject({ current: 1, promptPending: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('has nothing to keep for a step the person does', () => {
    guides.moveStep(taskId, 2);
    expect(offer).toHaveBeenCalledWith(taskId, null, BUSY_FOR_STEP);
    expect(savedGuide()).toMatchObject({ current: 2, promptPending: false });
  });

  it('gives the prompt to the running session, and tells the interface', () => {
    offer.mockReturnValue(true);
    guides.moveStep(taskId, 1);
    expect(savedGuide()).toMatchObject({ current: 1, promptPending: false });
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('stays on the step when the terminal cannot take the prompt', () => {
    offer.mockImplementation(() => {
      throw new Error(DRAFT_IN_THE_WAY);
    });
    expect(() => guides.moveStep(taskId, 1)).toThrow(DRAFT_IN_THE_WAY);
    expect(savedGuide()?.current).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('can start a guide of another playbook', () => {
    guides.change(taskId, { ...guide, playbookId: 'y', steps: [{ name: 'Plan', prompt: 'Plan it.' }] });
    expect(savedGuide()).toMatchObject({ playbookId: 'y', promptPending: true });
    expect(offer).toHaveBeenCalledWith(taskId, expect.stringContaining('Step 1 of 1, Plan'), BUSY_FOR_STEP);
  });
});

describe('steps the agent reports done', () => {
  let sessionId: string;
  beforeEach(() => {
    sessionId = randomUUID();
    const now = new Date().toISOString();
    home.store.saveSession({ id: sessionId, taskId, companyId: 'acme', accountId: 'a', cwd: home.root, state: 'working', startedAt: now, updatedAt: now });
  });
  const agentReports = (text: string) => writePrivateFile(home.paths.stepFile(sessionId), text);

  it('moves them into the guide, in order, and takes the report away', () => {
    agentReports('2\n1\n');
    guides.pollStepsDone(sessionId);
    expect(savedGuide()?.done).toEqual([1, 2]);
    expect(onChange).toHaveBeenCalledOnce();
    expect(existsSync(home.paths.stepFile(sessionId))).toBe(false);
    expect(readdirSync(dirname(home.paths.stepFile(sessionId))).filter((name) => name.endsWith('.reading'))).toEqual([]);
  });

  it('tells the interface only when something new is done', () => {
    home.store.updateTask(taskId, { guide: { ...guide, done: [1] } });
    agentReports('1\n');
    guides.pollStepsDone(sessionId);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ignores steps the guide does not have, and waits while nothing is reported', () => {
    guides.pollStepsDone(sessionId);
    agentReports('9\n');
    guides.pollStepsDone(sessionId);
    expect(savedGuide()?.done).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('takes the report of a task without a guide, and changes nothing', () => {
    home.store.updateTask(taskId, { guide: undefined });
    agentReports('1\n');
    guides.pollStepsDone(sessionId);
    expect(existsSync(home.paths.stepFile(sessionId))).toBe(false);
    expect(savedGuide()).toBeUndefined();
  });
});

describe('the step a guide sends by itself', () => {
  const byItself: TaskGuide = { ...guide, autoContinue: true, steps: [...guide.steps.slice(0, 2), { name: 'Post', prompt: 'Post it.', approval: true }, { name: 'Ask', you: 'Ask them.' }] };

  it('is the next open step, once the agent finished the current one', () => {
    expect(autoContinueStep({ ...byItself, done: [1] })).toBe(1);
  });

  it('is none while the current step is not finished, or when the guide waits for the person at every step', () => {
    expect(autoContinueStep(byItself)).toBeNull();
    expect(autoContinueStep({ ...byItself, autoContinue: false, done: [1] })).toBeNull();
    expect(autoContinueStep({ ...guide, done: [1] })).toBeNull();
  });

  it('is none before a step that needs approval, a step the person does, and at the end', () => {
    expect(autoContinueStep({ ...byItself, current: 1, done: [1, 2] })).toBeNull();
    expect(autoContinueStep({ ...byItself, current: 2, done: [1, 2, 3] })).toBeNull();
    expect(autoContinueStep({ ...byItself, steps: byItself.steps.slice(0, 2), current: 1, done: [1, 2] })).toBeNull();
  });

  it('skips a step the agent already finished while talking', () => {
    const three: TaskGuide = { ...byItself, steps: [...guide.steps.slice(0, 2), { name: 'Test', prompt: 'Test it.' }] };
    expect(autoContinueStep({ ...three, done: [1, 2] })).toBe(2);
  });
});

describe('a guide that continues by itself', () => {
  let sessionId: string;
  /** A running session whose agent just reported step 1 as finished, on a guide that continues by itself. */
  const reported = (change: Partial<TaskGuide> = {}) => {
    sessionId = randomUUID();
    const now = new Date().toISOString();
    home.store.saveSession({ id: sessionId, taskId, companyId: 'acme', accountId: 'a', cwd: home.root, state: 'working', startedAt: now, updatedAt: now });
    home.store.updateTask(taskId, { guide: { ...guide, autoContinue: true, ...change } });
    writePrivateFile(home.paths.stepFile(sessionId), '1\n');
    guides.pollStepsDone(sessionId);
    offer.mockReturnValue(true);
  };

  it('moves to the next step and sends it, telling the agent not to stop for a confirmation', () => {
    reported();
    guides.continueByItself(taskId, 'idle', false);
    expect(savedGuide()).toMatchObject({ current: 1, done: [1], autoContinue: true });
    expect(offer).toHaveBeenCalledExactlyOnceWith(taskId, expect.stringMatching(/^Step 2 of 3, Fix: Fix it\..* Continue without asking me to confirm\./), BUSY_FOR_STEP);
    expect(offer.mock.calls[0]?.[1]).toContain(CONTINUE_BY_ITSELF);
    expect(send).toHaveBeenCalledExactlyOnceWith(taskId);
  });

  it('sends each step once', () => {
    reported();
    guides.continueByItself(taskId, 'idle', false);
    guides.continueByItself(taskId, 'idle', false);
    expect(send).toHaveBeenCalledOnce();
  });

  it.each<SessionState>(['working', 'needs-input', 'background', 'stopped'])('waits while the session is %s, and sends once the agent is back at its prompt', (state) => {
    reported();
    guides.continueByItself(taskId, state, false);
    expect(offer).not.toHaveBeenCalled();
    expect(savedGuide()?.current).toBe(0);
    guides.continueByItself(taskId, 'idle', false);
    expect(send).toHaveBeenCalledOnce();
  });

  it('waits while the person has text in the terminal', () => {
    reported();
    guides.continueByItself(taskId, 'idle', true);
    expect(offer).not.toHaveBeenCalled();
    guides.continueByItself(taskId, 'idle', false);
    expect(send).toHaveBeenCalledOnce();
  });

  it('does nothing when the person did not ask for it', () => {
    reported({ autoContinue: false });
    guides.continueByItself(taskId, 'idle', false);
    expect(offer).not.toHaveBeenCalled();
  });

  it('reads no task while nothing was reported, so a session that waits costs nothing', () => {
    home.store.updateTask(taskId, { guide: { ...guide, autoContinue: true, done: [1] } });
    const findTask = vi.spyOn(home.store, 'findTask');
    guides.continueByItself(taskId, 'idle', false);
    expect(findTask).not.toHaveBeenCalled();
    expect(offer).not.toHaveBeenCalled();
  });

  it('stops before a step the person does', () => {
    reported({ current: 1, done: [2] });
    guides.continueByItself(taskId, 'idle', false);
    expect(offer).not.toHaveBeenCalled();
    expect(savedGuide()?.current).toBe(1);
  });

  it('leaves a finished task alone', () => {
    reported();
    home.store.updateTask(taskId, { status: 'done' });
    guides.continueByItself(taskId, 'idle', false);
    expect(offer).not.toHaveBeenCalled();
  });

  it('stays on the step when the terminal cannot take the prompt, and tries again later', () => {
    reported();
    offer.mockImplementationOnce(() => {
      throw new Error(DRAFT_IN_THE_WAY);
    });
    guides.continueByItself(taskId, 'idle', false);
    expect(savedGuide()?.current).toBe(0);
    expect(send).not.toHaveBeenCalled();
    guides.continueByItself(taskId, 'idle', false);
    expect(savedGuide()?.current).toBe(1);
    expect(send).toHaveBeenCalledOnce();
  });

  it('is turned on for a task, and sends a step that was already finished', () => {
    home.store.updateTask(taskId, { guide: { ...guide, done: [1] } });
    offer.mockReturnValue(true);
    guides.setAutoContinue(taskId, true);
    expect(savedGuide()?.autoContinue).toBe(true);
    expect(onChange).toHaveBeenCalledOnce();
    guides.continueByItself(taskId, 'idle', false);
    expect(savedGuide()?.current).toBe(1);
    expect(send).toHaveBeenCalledOnce();
  });

  it('is turned off, and then sends nothing', () => {
    reported();
    guides.setAutoContinue(taskId, false);
    guides.continueByItself(taskId, 'idle', false);
    expect(savedGuide()?.autoContinue).toBe(false);
    expect(offer).not.toHaveBeenCalled();
  });

  it('cannot be turned on for a task without a guide', () => {
    home.store.updateTask(taskId, { guide: undefined });
    expect(() => guides.setAutoContinue(taskId, true)).toThrow('This task has no guide.');
  });
});

describe('preparing a session to report steps', () => {
  it('puts the step command on the PATH, and tells the agent where to report', () => {
    expect(guides.prepareSession('session-1')).toEqual({ env: { HATSTAND_STEP_FILE: home.paths.stepFile('session-1') } });
    expect(readFileSync(home.paths.stepDoneTool, 'utf8')).toBe(STEP_DONE_TOOL);
    expect(statSync(home.paths.stepDoneTool).mode & 0o777).toBe(0o700);
  });
});
