import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { BUSY_FOR_STEP, guideAfterMove, SessionGuides, type GuideTerminals } from '../../src/main/session-guide';
import { STEP_DONE_TOOL } from '../../src/main/step-done-tool';
import { writePrivateFile } from '../../src/main/store';
import type { TaskGuide } from '../../src/shared/schemas';
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
let guides: SessionGuides;

beforeEach(() => {
  home = makeHome('hatstand-session-guide-');
  home.store.createCompany('Acme', '#112233');
  taskId = home.store.createTask({ companyId: 'acme', title: 'Fix it' }).id;
  home.store.updateTask(taskId, { guide });
  onChange = vi.fn<() => void>();
  offer = vi.fn<GuideTerminals['offerToRunningSession']>(() => false);
  guides = new SessionGuides(home.paths, home.store, { onChange }, { offerToRunningSession: offer });
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

describe('preparing a session to report steps', () => {
  it('puts the step command on the PATH, and tells the agent where to report', () => {
    expect(guides.prepareSession('session-1')).toEqual({ env: { HATSTAND_STEP_FILE: home.paths.stepFile('session-1') } });
    expect(readFileSync(home.paths.stepDoneTool, 'utf8')).toBe(STEP_DONE_TOOL);
    expect(statSync(home.paths.stepDoneTool).mode & 0o777).toBe(0o700);
  });
});
