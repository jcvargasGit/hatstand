import { Archive, ArchiveRestore, Check, Play, Plus, RotateCcw, Settings, Square, Trash2, Undo2, Maximize2, Minimize2, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useState } from 'react';
import type { Snapshot } from '../../../shared/api';
import { hasWorkspace } from '../../../shared/readiness';
import type { Task, TaskPatch } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { useNotesPanel } from '../hooks/useNotesPanel';
import { useShortcuts } from '../hooks/useShortcuts';
import { usePlaybooks } from '../hooks/usePlaybooks';
import { useTaskNotes } from '../hooks/useTaskNotes';
import { api } from '../lib/api';
import { plural } from '../lib/text';
import { shortcutLabel } from '../lib/shortcuts';
import { doneWarning } from '../lib/task-journey';
import { latestSession, taskStateText, isReadyToClose } from '../lib/today';
import { ClientAvatar } from './ClientAvatar';
import { GuideSteps } from './GuideSteps';
import { SubagentActivity } from './SubagentActivity';
import { TaskDetails } from './TaskDetails';
import { TaskNumber } from './TaskNumber';
import { TaskOverview } from './TaskOverview';
import { TaskStateIcon } from './TaskStateIcon';
import { TaskTitle } from './TaskTitle';
import { TerminalNotesPanel } from './TerminalNotesPanel';
import { TerminalView } from './TerminalView';
import { workRepositories } from '../../../shared/work-repos';

type TaskView = 'overview' | 'details' | 'terminal';

type TaskPanelProps = {
  snapshot: Snapshot;
  task: Task;
  onChanged: () => Promise<void>;
  onOpenClient: (companyId: string) => void;
  onSentBack: (companyId: string) => void;
};

export function TaskPanel({ snapshot, task, onChanged, onOpenClient, onSentBack }: TaskPanelProps) {
  const company = snapshot.companies.find((item) => item.id === task.companyId);
  const session = latestSession(snapshot.sessions, task.id);
  const isLive = session !== undefined && session.state !== 'stopped';
  const { error, busy, run } = useAction();
  const notes = useTaskNotes(task.id);
  const { playbooks } = usePlaybooks(task.companyId);
  const [view, setView] = useState<TaskView>(isLive ? 'terminal' : 'overview');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingDone, setConfirmingDone] = useState(false);
  const [terminalFull, setTerminalFull] = useState(false);
  const [terminalFocusRequest, setTerminalFocusRequest] = useState(0);
  const notesPanel = useNotesPanel();
  const focusTerminal = () => setTerminalFocusRequest((request) => request + 1);

  useShortcuts({
    '1': () => setView('overview'),
    '2': () => setView('details'),
    '3': () => {
      if (session) setView('terminal');
    },
    enter: () => {
      if (view === 'terminal' && session) setTerminalFull((full) => !full);
    },
  });

  if (!company) return null;

  const canStart = hasWorkspace(company);
  const showsTerminalFull = terminalFull && view === 'terminal' && session !== undefined;
  const accounts = snapshot.accounts.accounts;
  const effectiveAccountId = task.accountId ?? company.defaultAccountId ?? snapshot.accounts.defaultAccountId;
  const sessionAccount = accounts.find((item) => item.id === session?.accountId);
  const review = snapshot.reviews[task.id];
  const reviewedItem = { task, company, session, pulls: review?.pulls ?? [], branches: review?.branches ?? [] };
  const stateText = taskStateText(reviewedItem);
  const readyToClose = isReadyToClose(reviewedItem);
  const finished = task.status === 'done' || task.archivedAt !== undefined;
  const doneText = doneWarning(reviewedItem);
  const canSendBack = (task.status === 'todo' || task.status === 'doing') && !task.archivedAt;

  const patch = (change: TaskPatch) =>
    run(async () => {
      await api.updateTask(task.id, change);
      await onChanged();
    });

  const act = (action: () => Promise<unknown>) =>
    run(async () => {
      await action();
      await onChanged();
    });

  const markDone = () =>
    act(async () => {
      setConfirmingDone(false);
      if (isLive) await api.stopSession(session.id);
      await api.updateTask(task.id, { status: 'done' });
    });

  const sendBack = () =>
    run(async () => {
      await api.updateTask(task.id, { status: 'idea' });
      await onChanged();
      onSentBack(task.companyId);
    });

  const startThen = (action: () => Promise<unknown>) =>
    act(async () => {
      await action();
      setView('terminal');
    });

  const tabs: { id: TaskView; label: string; shortcut: string; disabled?: boolean }[] = [
    { id: 'overview', label: 'Overview', shortcut: '1' },
    { id: 'details', label: 'Details', shortcut: '2' },
    { id: 'terminal', label: 'Terminal', shortcut: '3', disabled: !session },
  ];

  const taskRepoCount = workRepositories(company).filter((repo) => task.projectIds.includes(repo.id)).length;

  return (
    <section className={showsTerminalFull ? 'panel is-terminal-full' : 'panel'} aria-label="Task">
      <header className="panel-head">
        <div className="panel-title">
          <p className="panel-client">
            <ClientAvatar company={company} size="small" />
            {company.name}
            <TaskNumber task={task} />
            {task.source && <span className="task-key">{task.source.key}</span>}
          </p>
          <TaskTitle key={task.id} title={task.title} disabled={busy} onRename={(title) => void patch({ title, customTitle: true })} />
        </div>
        <div className="panel-actions">
          {isLive ? (
            <button className="quiet" disabled={busy} onClick={() => void act(() => api.stopSession(session.id))}>
              <Square size={13} fill="currentColor" />
              Stop session
            </button>
          ) : (
            !finished && (
              <>
                {session && (
                  <button disabled={busy} onClick={() => void startThen(() => api.resumeSession(session.id))}>
                    <Play size={14} />
                    Resume session
                  </button>
                )}
                <button
                  className={session ? 'quiet' : undefined}
                  disabled={busy || !canStart}
                  onClick={() => void startThen(() => api.startSession(task.id))}
                >
                  {session ? <Plus size={15} /> : <Play size={14} />}
                  {session ? 'Start new session' : 'Start session'}
                </button>
              </>
            )
          )}
          {task.status === 'done' ? (
            <button className="quiet" disabled={busy} onClick={() => void patch({ status: session ? 'doing' : 'todo' })}>
              <RotateCcw size={15} />
              Reopen
            </button>
          ) : (
            <button
              className={readyToClose ? 'quiet close-ready' : 'quiet'}
              disabled={busy}
              onClick={() => {
                if (doneText) setConfirmingDone(true);
                else void markDone();
              }}
            >
              <Check size={15} />
              {readyToClose ? 'Close task' : isLive ? 'Stop and mark done' : 'Mark done'}
            </button>
          )}
          {canSendBack && (
            <button className="quiet" title={isLive ? 'Stop the session to send this task back' : 'Move this task out of your tasks, into the backlog'} disabled={busy || isLive} onClick={() => void sendBack()}>
              <Undo2 size={14} />
              Send back to backlog
            </button>
          )}
          {task.archivedAt ? (
            <button className="quiet" disabled={busy} onClick={() => void patch({ archivedAt: undefined })}>
              <ArchiveRestore size={14} />
              Restore
            </button>
          ) : (
            <button className="quiet" aria-label="Archive" title={isLive ? 'Stop the session to archive this task' : 'Archive'} disabled={busy || isLive} onClick={() => void patch({ archivedAt: new Date().toISOString() })}>
              <Archive size={14} />
            </button>
          )}
          {!confirmingDelete && (
            <button className="quiet" aria-label="Delete" title={isLive ? 'Stop the session to delete this task' : 'Delete'} disabled={busy || isLive} onClick={() => setConfirmingDelete(true)}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </header>

      <div className="task-tabs-row">
        <div className="task-tabs" role="tablist" aria-label="Task views">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              className="task-tab"
              aria-selected={view === tab.id}
              disabled={tab.disabled}
              title={tab.disabled ? 'Start a session first.' : `${tab.label} ${shortcutLabel(tab.shortcut)}`}
              onClick={() => setView(tab.id)}
            >
              {tab.label}
              {tab.id === 'terminal' && isLive && <span className="task-tab-live" aria-label="Session running" />}
            </button>
          ))}
        </div>
        <p className="panel-state">
          <TaskStateIcon item={{ task, company, session }} size={15} />
          <span>{stateText}</span>
          {taskRepoCount > 0 && <span>{plural(taskRepoCount, 'repository', 'repositories')}</span>}
          {task.source?.url && (
            <a href={task.source.url} target="_blank" rel="noreferrer">
              Open {task.source.key}
            </a>
          )}
        </p>
      </div>

      {confirmingDelete && (
        <p className="panel-confirm" role="alert">
          <span>Delete this task, its notes and its session history in Hatstand? This cannot be undone.</span>
          <button className="danger" disabled={busy} onClick={() => void act(() => api.deleteTask(task.id))}>
            Delete task
          </button>
          <button className="quiet" onClick={() => setConfirmingDelete(false)}>
            Cancel
          </button>
        </p>
      )}
      {confirmingDone && doneText && (
        <p className="panel-confirm" role="alert">
          <span>{doneText}</span>
          <button disabled={busy} onClick={() => void markDone()}>
            Mark done anyway
          </button>
          <button className="quiet" onClick={() => setConfirmingDone(false)}>
            Cancel
          </button>
        </p>
      )}
      {error && <p className="error panel-error">{error}</p>}

      {!canStart && (
        <p className="panel-blocked">
          <span>Add an area, a repository or a client folder to {company.name} before starting a session.</span>
          <button className="quiet" onClick={() => onOpenClient(company.id)}>
            <Settings size={15} />
            Set up client
          </button>
        </p>
      )}

      {view === 'overview' && (
        <TaskOverview
          item={{ task, company, session, pulls: review?.pulls ?? [] }}
          review={review}
          notes={notes}
          account={sessionAccount}
          session={session}
          canStart={canStart}
          clientTasks={task.backlogPlan ? snapshot.tasks.filter((item) => item.companyId === task.companyId) : undefined}
          onChanged={onChanged}
          onOpenDetails={() => setView('details')}
          onOpenTerminal={() => setView('terminal')}
        />
      )}

      {view === 'details' && (
        <TaskDetails
          snapshot={snapshot}
          task={task}
          company={company}
          playbooks={playbooks}
          notes={notes}
          isLive={isLive}
          refreshKey={session?.state ?? 'none'}
          effectiveAccountId={effectiveAccountId}
          patch={patch}
          onGuideChange={(playbookId) => act(() => api.setTaskGuide(task.id, playbookId))}
          onChanged={onChanged}
        />
      )}

      {view === 'terminal' && session && (
        <>
          {task.guide && <GuideSteps key={task.id} task={task} guide={task.guide} session={session} onChanged={onChanged} />}
          <div className="terminal-frame">
            <div className="terminal-bar">
              <p className="terminal-account" title={session.cwd}>
                {showsTerminalFull && <strong>{task.title}: </strong>}
{isLive ? 'Running' : 'Last ran'} with {sessionAccount?.name ?? 'an agent'} ({sessionAccount?.label}) in {session.cwd}
              </p>
              <button
                className="quiet"
                aria-expanded={notesPanel.open}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (notesPanel.open) focusTerminal();
                  notesPanel.toggle();
                }}
              >
                {notesPanel.open ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
                {notesPanel.open ? 'Hide note' : 'Show note'}
              </button>
              <button
                className="quiet"
                title={(showsTerminalFull ? 'Exit full screen ' : 'Full screen ') + shortcutLabel('Enter')}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setTerminalFull((full) => !full)}
              >
                {showsTerminalFull ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                {showsTerminalFull ? 'Exit full screen' : 'Full screen'}
              </button>
            </div>
            <div className="terminal-row">
              <TerminalView key={session.id} sessionId={session.id} focusRequest={terminalFocusRequest} />
              {notesPanel.open && <TerminalNotesPanel taskId={task.id} session={session} notes={notes} onLeave={focusTerminal} />}
            </div>
            <SubagentActivity session={session} />
          </div>
        </>
      )}
    </section>
  );
}
