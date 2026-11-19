// What each turn of a session changed outside git. A snapshot of the folders the session can write to is
// taken when the agent starts working and compared when it stops, which also finds files written with
// shell commands. The snapshot of a running turn is kept in a file, so a turn the app did not see end
// is finished the next time its changes are asked for.
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { Session, SessionState } from '../shared/schemas';
import { diffSnapshots, snapshotFolders, snapshotSchema, type SnapshotOptions } from './folder-snapshot';
import { clientRepos, isInside, realPath, recordOutsideChanges, recordToolWrites, watchedFolders } from './outside-changes';
import type { DataPaths } from './paths';
import { writePrivateFile, type Store } from './store';

const turnSchema = z.object({ taskId: z.string(), folders: z.array(z.string()), snapshot: snapshotSchema });
type Turn = z.infer<typeof turnSchema>;

type SessionRef = Pick<Session, 'id' | 'taskId' | 'companyId' | 'cwd'>;

/** The agent reports that it works up to one poll before Hatstand reads it, and may have written a file by then. */
const REPORT_MARGIN_MS = 1000;

const isResting = (state: SessionState) => state === 'idle' || state === 'background' || state === 'stopped';

/** The files Hatstand writes itself in the tasks folder of a client. They are its own data, not the work of the agent. */
export function isAppFile(paths: DataPaths, companyId: string): (file: string) => boolean {
  const tasks = realPath(paths.tasksDir(companyId));
  return (file) => isInside(file, [join(tasks, 'plans')]) || (dirname(file) === tasks && /(\.json|\.tmp|\.feedback\.md)$/.test(file));
}

export class SessionChanges {
  /** The folders each running session can write to, and when it was started: nothing older is the work of its agent. */
  private readonly running = new Map<string, { folders: string[]; startedAt: number }>();
  /** The work in progress for each task. Its steps run one after the other, so a turn ends after it started. */
  private readonly work = new Map<string, Promise<void>>();

  constructor(
    private readonly paths: DataPaths,
    private readonly store: Pick<Store, 'findTask' | 'readCompany' | 'listSessions'>,
    private readonly limits?: SnapshotOptions['limits'],
  ) {}

  prepareSession(session: SessionRef, addDirs: string[]): void {
    this.running.set(session.id, { folders: [...addDirs, session.cwd], startedAt: Date.now() });
  }

  /** Called on every change of state of a session. A turn starts when the agent starts working, and ends when it rests. */
  stateChanged(session: Session, previous: SessionState): void {
    if (session.state === 'working' && isResting(previous)) this.enqueue(session.taskId, () => this.startTurn(session));
    if (isResting(session.state)) this.enqueue(session.taskId, () => this.endTurn(session, session.state === 'background'));
    if (session.state === 'stopped') this.running.delete(session.id);
  }

  /** Resolves when the changes of the task are recorded, including a turn left open by a session that is no longer running. */
  settled(taskId: string): Promise<void> {
    for (const session of this.store.listSessions()) {
      if (session.taskId === taskId && !this.running.has(session.id) && existsSync(this.paths.turnSnapshotFile(session.id))) {
        this.enqueue(taskId, () => this.endTurn(session, false));
      }
    }
    return this.work.get(taskId) ?? Promise.resolve();
  }

  private enqueue(taskId: string, step: () => Promise<void>): void {
    const next = (this.work.get(taskId) ?? Promise.resolve()).then(step).catch(() => undefined);
    this.work.set(taskId, next);
    void next.then(() => {
      if (this.work.get(taskId) === next) this.work.delete(taskId);
    });
  }

  private snapshotOptions(session: SessionRef): Required<Pick<SnapshotOptions, 'skip' | 'ignore'>> & Pick<SnapshotOptions, 'limits'> {
    const company = this.store.readCompany(session.companyId);
    return { skip: clientRepos(company, this.store.findTask(session.taskId)), ignore: isAppFile(this.paths, company.id), limits: this.limits };
  }

  /** When the agent last reported its state, which is when its turn started unless it already ran a tool. */
  private reportedWorkingAt(sessionId: string): number {
    try {
      return Math.min(statSync(this.paths.statusFile(sessionId)).mtimeMs, Date.now());
    } catch {
      return Date.now();
    }
  }

  private readTurn(sessionId: string): Turn | null {
    try {
      return turnSchema.parse(JSON.parse(readFileSync(this.paths.turnSnapshotFile(sessionId), 'utf8')));
    } catch {
      return null;
    }
  }

  private writeTurn(sessionId: string, turn: Turn): void {
    writePrivateFile(this.paths.turnSnapshotFile(sessionId), JSON.stringify(turn));
  }

  /** A turn that follows work in the background keeps the snapshot it has, so nothing written in between is lost. */
  private async startTurn(session: SessionRef): Promise<void> {
    if (this.readTurn(session.id)) return;
    const options = this.snapshotOptions(session);
    const running = this.running.get(session.id);
    const folders = watchedFolders(running?.folders ?? [session.cwd], options.skip);
    const since = Math.max(this.reportedWorkingAt(session.id) - REPORT_MARGIN_MS, running?.startedAt ?? 0);
    this.writeTurn(session.id, { taskId: session.taskId, folders, snapshot: await snapshotFolders(folders, { ...options, since }) });
  }

  private async endTurn(session: SessionRef, staysOpen: boolean): Promise<void> {
    const file = this.paths.turnSnapshotFile(session.id);
    try {
      recordToolWrites(this.paths, session.taskId, [session.id]);
      const turn = this.readTurn(session.id);
      if (!turn) return;
      const options = this.snapshotOptions(session);
      const after = await snapshotFolders(turn.folders, options);
      const { changes, truncated } = diffSnapshots(turn.snapshot, after);
      recordOutsideChanges(this.paths, session.taskId, { changes: changes.filter((change) => !isInside(change.path, options.skip)), folders: turn.folders, truncated });
      if (staysOpen) this.writeTurn(session.id, { ...turn, snapshot: after });
    } finally {
      if (!staysOpen) rmSync(file, { force: true });
    }
  }
}
