import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { taskOutsideChanges } from '../../src/main/outside-changes';
import { SessionManager } from '../../src/main/sessions';
import type { Session, Task } from '../../src/shared/schemas';
import { makeHome, type TestHome } from '../helpers/home';
import { fakeAgentBin, fakeProtection, noSecrets } from '../helpers/sessions';

vi.mock('node-pty', () => ({
  spawn: () => ({ write: () => {}, onData: () => {}, onExit: () => {}, kill: () => {}, resize: () => {} }),
}));

const POLL_MS = 1000;
let home: TestHome;
/** The folder the agent works in, which has no git. */
let work: string;
let sessions: SessionManager;
let task: Task;
let session: Session;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  home = makeHome('hatstand-session-outside-');
  home.store.saveCompany({ ...home.store.createCompany('Acme', '#112233'), rootDir: home.folder('acme-work') });
  sessions = new SessionManager(home.paths, home.store, noSecrets, fakeAgentBin(home.root), { onData: () => {}, onChange: () => {}, onNeedsInput: () => {} }, fakeProtection());
  task = home.store.createTask({ companyId: 'acme', title: 'Write the plan' });
  session = await sessions.start(task.id);
  work = session.cwd;
});

afterEach(() => {
  sessions.stopAll();
  vi.useRealTimers();
  home.remove();
});

/** The agent reports a state through its status file, and the session reads it on its next poll. */
const agentReports = async (state: 'working' | 'idle') => {
  writeFileSync(home.paths.statusFile(session.id), state);
  vi.advanceTimersByTime(POLL_MS);
  await sessions.outsideChangesSettled(task.id);
};
const listed = () => taskOutsideChanges(home.paths, home.store, home.store.readCompany('acme'), home.store.findTask(task.id)).folders;

describe('a session of a task that writes outside git', () => {
  it('lists the file the agent wrote in a folder without git, with its full path, once the turn ends', async () => {
    await agentReports('working');
    expect(listed()).toEqual([]);
    mkdirSync(join(work, 'notes'));
    writeFileSync(join(work, 'notes', 'plan.md'), '# Plan\n');
    await agentReports('idle');
    expect(listed()).toEqual([{ folder: work, changes: [{ path: join(work, 'notes', 'plan.md'), status: 'added' }] }]);
  });

  it('follows the folders the session was given, such as the notes and documents of its task', async () => {
    const report = join(home.paths.tasksDir('acme'), `${task.id}.report.md`);
    await agentReports('working');
    writeFileSync(report, '# Report\n');
    await agentReports('idle');
    expect(listed()).toEqual([{ folder: home.paths.tasksDir('acme'), changes: [{ path: report, status: 'added' }] }]);
  });

  it('lists a file a tool of the agent wrote as soon as its hook records it', async () => {
    await agentReports('working');
    writeFileSync(join(work, 'by-tool.md'), 'x');
    appendFileSync(home.paths.activityFile(session.id), `${JSON.stringify({ hook_event_name: 'HatstandFileWrite', kind: 'create', file_path: join(work, 'by-tool.md') })}\n`);
    expect(listed()).toEqual([{ folder: work, changes: [{ path: join(work, 'by-tool.md'), status: 'added' }] }]);
  });

  it('lists nothing for a turn in which the agent wrote nothing', async () => {
    await agentReports('working');
    await agentReports('idle');
    expect(listed()).toEqual([]);
  });
});
