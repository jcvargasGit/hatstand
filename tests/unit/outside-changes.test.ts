import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { taskRepoChanges } from '../../src/main/git-changes';
import { MAX_OUTSIDE_CHANGES, mergeStatus, recordOutsideChanges, taskOutsideChanges, watchedFolders } from '../../src/main/outside-changes';
import { createChangeService } from '../../src/main/services/changes';
import { createDesktopTargets } from '../../src/main/services/desktop-targets';
import { isAppFile, SessionChanges } from '../../src/main/session-changes';
import { SessionStates } from '../../src/main/session-state';
import { writePrivateFile } from '../../src/main/store';
import type { Session, SessionState, Task } from '../../src/shared/schemas';
import { makeCommittedRepo, makeHome, type TestHome } from '../helpers/home';
import { makeServiceContext } from '../helpers/services';

let home: TestHome;
let api: string;
let planning: string;
let knowledge: string;
let task: Task;
let session: Session;
let tracker: SessionChanges;

beforeEach(() => {
  home = makeHome('hatstand-outside-');
  api = makeCommittedRepo(home.folder('code', 'api'));
  planning = home.folder('acme-planning');
  knowledge = home.folder('acme-knowledge');
  home.store.saveCompany({ ...home.store.createCompany('Acme', '#112233'), projects: [{ id: 'api', name: 'api', path: api }] });
  task = home.store.updateTask(home.store.createTask({ companyId: 'acme', title: 'Write the plan', projectIds: ['api'] }).id, { isolated: false });
  const now = new Date().toISOString();
  session = { id: randomUUID(), taskId: task.id, companyId: 'acme', accountId: 'a', cwd: api, state: 'idle', startedAt: now, updatedAt: now };
  home.store.saveSession(session);
  mkdirSync(home.paths.tasksDir('acme'), { recursive: true });
  mkdirSync(home.paths.runDir, { recursive: true });
  tracker = new SessionChanges(home.paths, home.store);
  tracker.prepareSession(session, [knowledge, planning, home.paths.tasksDir('acme')]);
});
afterEach(() => home.remove());

const company = () => home.store.readCompany('acme');
const listed = () => taskOutsideChanges(home.paths, home.store, company(), task);
const allChanges = () => listed().folders.flatMap((folder) => folder.changes);
const write = (file: string, content = 'x') => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};
/** A file that was there long before the turn. */
const writeOld = (file: string, content = 'x') => {
  write(file, content);
  utimesSync(file, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));
};
const toolWrote = (file: string, kind = 'update', sessionId = session.id) =>
  appendFileSync(home.paths.activityFile(sessionId), `${JSON.stringify({ hook_event_name: 'HatstandFileWrite', kind, file_path: file })}\n`);

/** One turn of the agent: it starts working, does something, and stops. */
const turn = async (work: () => void, end: SessionState = 'idle') => {
  tracker.stateChanged({ ...session, state: 'working' }, 'idle');
  await tracker.settled(task.id);
  work();
  tracker.stateChanged({ ...session, state: end }, 'working');
  await tracker.settled(task.id);
};

describe('the files the agent wrote with its tools', () => {
  it('are listed with their full path, under the folder the session could write to', async () => {
    await turn(() => {
      write(join(planning, 'q3', 'roadmap.md'));
      toolWrote(join(planning, 'q3', 'roadmap.md'), 'create');
    });
    expect(listed()).toEqual({ folders: [{ folder: planning, changes: [{ path: join(planning, 'q3', 'roadmap.md'), status: 'added' }] }], truncated: false });
  });

  it('are listed while the agent still works, before its turn ends', () => {
    write(join(knowledge, 'glossary.md'));
    toolWrote(join(knowledge, 'glossary.md'));
    expect(allChanges()).toEqual([{ path: join(knowledge, 'glossary.md'), status: 'modified' }]);
  });

  it('are listed even in a folder no snapshot covers, under the folder of the file', async () => {
    const elsewhere = home.folder('elsewhere');
    await turn(() => {
      write(join(elsewhere, 'report.md'));
      toolWrote(join(elsewhere, 'report.md'), 'create');
    });
    expect(listed().folders).toEqual([{ folder: elsewhere, changes: [{ path: join(elsewhere, 'report.md'), status: 'added' }] }]);
  });

  it('are read once, so a file deleted later does not come back', async () => {
    write(join(planning, 'draft.md'));
    toolWrote(join(planning, 'draft.md'), 'create');
    expect(allChanges()).toHaveLength(1);
    await turn(() => rmSync(join(planning, 'draft.md')));
    expect(allChanges()).toEqual([]);
    expect(allChanges()).toEqual([]);
  });

  it('wait for a line that is still being written', () => {
    write(join(planning, 'a.md'));
    appendFileSync(home.paths.activityFile(session.id), `{"hook_event_name":"HatstandFileWrite","kind":"update","file_path":"${join(planning, 'a.md')}`);
    expect(allChanges()).toEqual([]);
    appendFileSync(home.paths.activityFile(session.id), '"}\n');
    expect(allChanges()).toEqual([{ path: join(planning, 'a.md'), status: 'modified' }]);
  });

  it('come from every session of the task, and from no other task', () => {
    const second = { ...session, id: randomUUID() };
    home.store.saveSession(second);
    const other = home.store.createTask({ companyId: 'acme', title: 'Another task' });
    const foreign = { ...session, id: randomUUID(), taskId: other.id };
    home.store.saveSession(foreign);
    for (const name of ['one.md', 'two.md', 'three.md']) write(join(planning, name));
    toolWrote(join(planning, 'one.md'));
    toolWrote(join(planning, 'two.md'), 'update', second.id);
    toolWrote(join(planning, 'three.md'), 'update', foreign.id);
    expect(allChanges().map((change) => change.path)).toEqual([join(planning, 'one.md'), join(planning, 'two.md')]);
  });
});

describe('the files the agent wrote with shell commands', () => {
  it('are found at the end of the turn: created, modified and deleted', async () => {
    writeOld(join(planning, 'edited.md'), 'before');
    writeOld(join(planning, 'removed.md'));
    await turn(() => {
      write(join(planning, 'edited.md'), 'after, and longer');
      write(join(knowledge, 'created.md'));
      rmSync(join(planning, 'removed.md'));
    });
    expect(listed().folders).toEqual([
      { folder: knowledge, changes: [{ path: join(knowledge, 'created.md'), status: 'added' }] },
      {
        folder: planning,
        changes: [
          { path: join(planning, 'edited.md'), status: 'modified' },
          { path: join(planning, 'removed.md'), status: 'deleted' },
        ],
      },
    ]);
  });

  it('include a new repository, as one entry', async () => {
    await turn(() => makeCommittedRepo(join(planning, 'new-tool')));
    expect(allChanges()).toEqual([{ path: join(planning, 'new-tool'), status: 'repository' }]);
  });

  it('are new when the file was not there at the start, even when a tool only reported an edit', async () => {
    await turn(() => {
      write(join(planning, 'plan.md'));
      toolWrote(join(planning, 'plan.md'), 'update');
    });
    expect(allChanges()).toEqual([{ path: join(planning, 'plan.md'), status: 'added' }]);
  });

  it('add up over several turns', async () => {
    await turn(() => write(join(planning, 'plan.md'), 'one'));
    await turn(() => write(join(planning, 'plan.md'), 'two, longer'));
    expect(allChanges()).toEqual([{ path: join(planning, 'plan.md'), status: 'added' }]);
    await turn(() => rmSync(join(planning, 'plan.md')));
    expect(allChanges()).toEqual([]);
  });

  it('are found after work in the background too', async () => {
    await turn(() => write(join(planning, 'first.md')), 'background');
    write(join(planning, 'later.md'));
    tracker.stateChanged({ ...session, state: 'idle' }, 'background');
    await tracker.settled(task.id);
    expect(allChanges().map((change) => change.path)).toEqual([join(planning, 'first.md'), join(planning, 'later.md')]);
    expect(existsSync(home.paths.turnSnapshotFile(session.id))).toBe(false);
  });

  it('are found for a turn the app did not see end, once the session is no longer running', async () => {
    tracker.stateChanged({ ...session, state: 'working' }, 'idle');
    await tracker.settled(task.id);
    write(join(planning, 'unfinished.md'));
    const afterRestart = new SessionChanges(home.paths, home.store);
    await afterRestart.settled(task.id);
    expect(allChanges()).toEqual([{ path: join(planning, 'unfinished.md'), status: 'added' }]);
  });

  it('leave out a file written just before the session started, which cannot be the work of its agent', async () => {
    write(join(planning, 'written-by-the-person.md'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    tracker = new SessionChanges(home.paths, home.store);
    tracker.prepareSession(session, [planning]);
    await turn(() => write(join(planning, 'written-by-the-agent.md')));
    expect(allChanges().map((change) => change.path)).toEqual([join(planning, 'written-by-the-agent.md')]);
  });

  it('leave out the files Hatstand writes itself in the tasks folder, and keep the notes and documents', async () => {
    const tasks = home.paths.tasksDir('acme');
    await turn(() => {
      write(join(tasks, `${task.id}.feedback.md`));
      write(join(tasks, 'plans', `${task.id}.json`), '{}');
      write(join(tasks, `${task.id}.md`), '## TL;DR');
      write(join(tasks, `${task.id}.report.md`));
    });
    expect(allChanges().map((change) => change.path)).toEqual([join(tasks, `${task.id}.md`), join(tasks, `${task.id}.report.md`)]);
    expect(isAppFile(home.paths, 'acme')(join(tasks, 'other.json'))).toBe(true);
    expect(isAppFile(home.paths, 'acme')(join(planning, 'data.json'))).toBe(false);
  });

  it('are reported as cut short when a folder has more files than the limit', async () => {
    const limited = new SessionChanges(home.paths, home.store, { maxFiles: 3, maxDepth: 8 });
    limited.prepareSession(session, [planning]);
    for (const name of ['a', 'b', 'c', 'd', 'e']) writeOld(join(planning, `${name}.md`));
    limited.stateChanged({ ...session, state: 'working' }, 'idle');
    await limited.settled(task.id);
    write(join(planning, '0-new.md'));
    limited.stateChanged({ ...session, state: 'idle' }, 'working');
    await limited.settled(task.id);
    expect(listed().truncated).toBe(true);
    expect(allChanges().map((change) => change.path)).toContain(join(planning, '0-new.md'));
  });
});

describe('paths inside the repositories git already reports', () => {
  it('are not listed again, whether a tool or a shell command wrote them', async () => {
    await turn(() => {
      write(join(api, 'src', 'login.ts'));
      toolWrote(join(api, 'src', 'login.ts'), 'create');
      write(join(api, 'shell.txt'));
    });
    expect(listed().folders).toEqual([]);
    const [report] = await taskRepoChanges(company(), task, process.env.PATH ?? '', new Date(0).toISOString());
    expect(report?.changes.map((change) => change.path).sort()).toEqual(['shell.txt', 'src/login.ts']);
  });

  it('are listed when the folder of a repository has no git, which Changes used to drop', async () => {
    const docs = home.folder('code', 'docs');
    home.store.saveCompany({ ...company(), projects: [...company().projects, { id: 'docs', name: 'docs', path: docs }] });
    task = home.store.updateTask(task.id, { projectIds: ['docs'] });
    tracker.prepareSession({ ...session, cwd: docs }, [planning]);
    await turn(() => {
      write(join(docs, 'guide.md'));
      toolWrote(join(docs, 'guide.md'), 'create');
      write(join(docs, 'by-shell.md'));
    });
    expect(await taskRepoChanges(company(), task, process.env.PATH ?? '', new Date(0).toISOString())).toEqual([]);
    expect(listed().folders).toEqual([
      {
        folder: docs,
        changes: [
          { path: join(docs, 'by-shell.md'), status: 'added' },
          { path: join(docs, 'guide.md'), status: 'added' },
        ],
      },
    ]);
  });

  it('are compared after resolving links, so a link to a repository is still that repository', async () => {
    const link = join(home.root, 'api-link');
    symlinkSync(api, link);
    write(join(api, 'via-link.ts'));
    toolWrote(join(link, 'via-link.ts'), 'create');
    expect(listed().folders).toEqual([]);
  });

  it('are not read by a snapshot at all', () => {
    expect(watchedFolders([api, planning, join(planning, 'q3'), planning, join(home.root, 'missing')], [api])).toEqual([planning]);
  });
});

describe('what a file becomes after one more change', () => {
  it('follows the file through its changes', () => {
    expect(mergeStatus(undefined, 'modified')).toBe('modified');
    expect(mergeStatus('added', 'modified')).toBe('added');
    expect(mergeStatus('modified', 'added')).toBe('added');
    expect(mergeStatus('added', 'deleted')).toBeNull();
    expect(mergeStatus('modified', 'deleted')).toBe('deleted');
    expect(mergeStatus('deleted', 'added')).toBe('modified');
    expect(mergeStatus('repository', 'modified')).toBe('repository');
  });
});

describe('the limit of the list', () => {
  it('shows the first files only, and says so', () => {
    const changes = Array.from({ length: MAX_OUTSIDE_CHANGES + 5 }, (_, index) => ({ path: join(planning, `file-${String(index).padStart(4, '0')}.md`), status: 'deleted' as const }));
    recordOutsideChanges(home.paths, task.id, { changes, folders: [planning], truncated: false });
    expect(allChanges()).toHaveLength(MAX_OUTSIDE_CHANGES);
    expect(listed().truncated).toBe(true);
  });
});

describe('the session reports each change of state', () => {
  it('so a turn starts when the agent works and ends when it stops', async () => {
    const running = { startedAt: 0, turnCheck: null, state: 'idle' as SessionState };
    const states = new SessionStates(
      home.paths,
      home.store,
      { onChange: () => {}, onNeedsInput: () => {}, onStateChange: (changed, previous) => tracker.stateChanged(changed, previous) },
      () => running,
    );
    writePrivateFile(home.paths.statusFile(session.id), 'working');
    states.poll(session.id);
    await tracker.settled(task.id);
    expect(existsSync(home.paths.turnSnapshotFile(session.id))).toBe(true);
    write(join(planning, 'from-the-turn.md'));
    writePrivateFile(home.paths.statusFile(session.id), 'idle');
    states.poll(session.id);
    await tracker.settled(task.id);
    expect(allChanges()).toEqual([{ path: join(planning, 'from-the-turn.md'), status: 'added' }]);
  });
});

describe('the services for the files outside git', () => {
  const service = (settled: () => Promise<void> = async () => {}) => createChangeService(makeServiceContext(home).ctx, { sessions: { outsideChangesSettled: settled } });
  const targets = () => createDesktopTargets(makeServiceContext(home).ctx);

  it('wait for the turn to be recorded before they answer', async () => {
    tracker.stateChanged({ ...session, state: 'working' }, 'idle');
    await tracker.settled(task.id);
    write(join(planning, 'plan.md'), 'the plan\n');
    tracker.stateChanged({ ...session, state: 'idle' }, 'working');
    const found = await service(() => tracker.settled(task.id)).taskOutsideChanges(task.id);
    expect(found.folders).toEqual([{ folder: planning, changes: [{ path: join(planning, 'plan.md'), status: 'added' }] }]);
  });

  it('show a new text file as added lines, and say why a modified one has no diff', async () => {
    writeOld(join(planning, 'old.md'), 'before');
    await turn(() => {
      write(join(planning, 'plan.md'), 'the plan\nsecond line\n');
      write(join(planning, 'old.md'), 'after, and longer');
      write(join(planning, 'image.bin'), 'a\0b');
    });
    expect(await service().taskOutsideFile(task.id, join(planning, 'plan.md'))).toBe('+the plan\n+second line');
    expect(await service().taskOutsideFile(task.id, join(planning, 'old.md'))).toContain('no earlier copy');
    expect(await service().taskOutsideFile(task.id, join(planning, 'image.bin'))).toBe('This new file is binary.');
  });

  it('open a recorded file, and the folder of a new repository', async () => {
    await turn(() => {
      write(join(planning, 'plan.md'));
      makeCommittedRepo(join(planning, 'tool'));
    });
    expect(targets().taskChangedFile(task.id, join(planning, 'plan.md'))).toEqual({ kind: 'file', path: join(planning, 'plan.md') });
    expect(targets().taskChangedFile(task.id, join(planning, 'tool'))).toEqual({ kind: 'folder', path: join(planning, 'tool') });
  });

  it('refuse a path Hatstand did not record for that task', async () => {
    writeOld(join(planning, 'secret.md'));
    await turn(() => write(join(planning, 'plan.md')));
    const other = home.store.createTask({ companyId: 'acme', title: 'Another task' });
    expect(() => targets().taskChangedFile(task.id, join(planning, 'secret.md'))).toThrow('not among the changes');
    expect(() => targets().taskChangedFile(other.id, join(planning, 'plan.md'))).toThrow('not among the changes');
    await expect(service().taskOutsideFile(task.id, join(planning, 'secret.md'))).rejects.toThrow('not among the changes');
  });

  it('forget the record when the task is deleted', async () => {
    await turn(() => write(join(planning, 'plan.md')));
    expect(existsSync(home.paths.taskChangesFile(task.id))).toBe(true);
    home.store.deleteTask(task.id);
    expect(existsSync(home.paths.taskChangesFile(task.id))).toBe(false);
  });
});
