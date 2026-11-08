import { Check, ExternalLink, FolderOpen, Pencil, SquareTerminal } from 'lucide-react';
import type { Account, Session, Task, TaskReview } from '../../../shared/schemas';
import { finishedWork } from '../../../shared/task-finish';
import { useAction } from '../hooks/useAction';
import { useEditorName } from '../hooks/useEditorName';
import { useTaskChanges } from '../hooks/useTaskChanges';
import { api } from '../lib/api';
import { checklistProgress } from '../lib/inbox';
import { taskJourney } from '../lib/task-journey';
import { baseLabel } from '../lib/text';
import { isReadyToClose, taskStateText, type TodayItem } from '../lib/today';
import { BacklogPlanReview } from './BacklogPlanReview';
import { GuideSteps } from './GuideSteps';
import { MarkdownView } from './MarkdownView';
import { TaskNotes } from './TaskNotes';
import { changeSummary } from './TaskChanges';
import { TaskChecklist } from './TaskChecklist';
import { TaskOutputs } from './TaskOutputs';
import { TaskPullRequests } from './TaskPullRequests';
import { workRepositories } from '../../../shared/work-repos';

type TaskOverviewProps = {
  item: TodayItem;
  review?: TaskReview;
  notes: string;
  account?: Account;
  session?: Session;
  canStart: boolean;
  clientTasks?: Task[];
  onChanged: () => Promise<void>;
  onOpenDetails: () => void;
  onOpenTerminal: () => void;
};

export function TaskOverview({ item, review, notes, account, session, canStart, clientTasks = [], onChanged, onOpenDetails, onOpenTerminal }: TaskOverviewProps) {
  const { task, company } = item;
  const { repos } = useTaskChanges(task.id, session?.state ?? 'none');
  const journey = taskJourney(item, repos.reduce((total, repo) => total + repo.commits, 0));
  const editor = useAction();
  const editorName = useEditorName();
  const hasCopies = task.isolated && task.worktrees.length > 0;
  const workRepos = workRepositories(company);
  const reading = workRepos.filter((project) => task.projectIds.includes(project.id) && !task.worktrees.some((worktree) => worktree.projectId === project.id));
  const showChangesFirst = hasCopies && journey.reviewing;
  const repoName = (projectId: string) => company.projects.find((project) => project.id === projectId)?.name ?? 'Repository';
  const hasPulls = (review?.pulls.length ?? 0) > 0 || Boolean(review?.error);
  const area = company.subdomains.find((item) => item.id === task.subdomainId);
  const hasCode = !task.backlogPlan && (workRepos.length > 0 || Boolean(company.rootDir));

  return (
    <div className="task-overview">
      <section className="overview-card overview-journey" aria-label="Where this task is">
        <ol className="journey-stages">
          {journey.stages.map((stage, index) => {
            const done = index < journey.stage || (journey.finished && index === journey.stage);
            return (
              <li key={stage} className={done ? 'is-done' : index === journey.stage ? 'is-current' : undefined} aria-current={index === journey.stage ? 'step' : undefined}>
                <span className="journey-dot">{done && <Check size={11} />}</span>
                {stage}
              </li>
            );
          })}
        </ol>
        <dl className="journey-facts">
          <div>
            <dt>Source</dt>
            <dd>{journey.kind}</dd>
          </div>
          {area && (
            <div>
              <dt>Area</dt>
              <dd>{area.name}</dd>
            </div>
          )}
          {task.source && (
            <div>
              <dt>Issue</dt>
              <dd>
                {task.source.url ? (
                  <a href={task.source.url} target="_blank" rel="noreferrer">
                    {task.source.key}
                  </a>
                ) : (
                  task.source.key
                )}
              </dd>
            </div>
          )}
          {task.priority !== 'none' && (
            <div>
              <dt>Priority</dt>
              <dd className="priority-text">{task.priority}</dd>
            </div>
          )}
          <div>
            <dt>Where it is</dt>
            <dd>{journey.now}</dd>
          </div>
          <div>
            <dt>Where it goes</dt>
            <dd>{journey.next}</dd>
          </div>
        </dl>
      </section>

      {task.backlogPlan && <BacklogPlanReview task={task} company={company} tasks={clientTasks} />}

      {task.guide && (
        <div className="overview-wide">
          <GuideSteps key={task.id} task={task} guide={task.guide} session={session} onChanged={onChanged} />
        </div>
      )}

      {task.description && (
        <section className="overview-card" aria-label="About this task">
          <h3>About this task</h3>
          <MarkdownView text={task.description} />
        </section>
      )}

      <section className="overview-card" aria-label="Notes">
        <div className="overview-head">
          <h3>Where it stands</h3>
          <button className="quiet" disabled={editor.busy} onClick={() => void editor.run(async () => void (await api.openTaskNotesInEditor(task.id)))}>
            <Pencil size={14} />
            {editorName ? `Edit in ${editorName}` : 'Edit'}
          </button>
        </div>
        {isReadyToClose(item) && <p className="hint">{finishedWork(item) === 'merged' ? 'This work is in the main branch. Close the task when you are finished.' : 'The agent reports that nothing is left. Close the task, or reply to the agent.'}</p>}
        <TaskNotes notes={notes} empty="No notes yet. The agent keeps them current, with a short summary, what it did last and what is pending." />
      </section>

      <TaskOutputs taskId={task.id} />

      <section className="overview-card" aria-label="Checklist">
        <div className="overview-head">
          <h3>Checklist</h3>
          {task.checklist.length > 0 && <span className="hint">{checklistProgress(task)}</span>}
        </div>
        <TaskChecklist task={task} onChanged={onChanged} />
      </section>

      <section className="overview-card" aria-label="Session">
        <div className="overview-head">
          <h3>Session</h3>
          {session && (
            <button className="quiet" onClick={onOpenTerminal}>
              <SquareTerminal size={14} />
              Open terminal
            </button>
          )}
        </div>
        {session ? (
          <dl className="overview-list">
            <div>
              <dt>Agent</dt>
              <dd>
                {account?.name ?? 'An agent'} {account && `(${account.label})`}
              </dd>
            </div>
            <div>
              <dt>State</dt>
              <dd>{taskStateText({ ...item, pulls: [] })}</dd>
            </div>
            <div>
              <dt>Last activity</dt>
              <dd>{new Date(session.updatedAt).toLocaleString()}</dd>
            </div>
          </dl>
        ) : (
          <p className="hint">{canStart ? 'Starting a session opens the agent with this client’s context and a suggested prompt already written. Press Enter to send it, or change it first.' : 'This client needs an area, a repository or a folder first.'}</p>
        )}
      </section>

      {hasCode && (
      <section className={`overview-card${showChangesFirst ? ' overview-changes-first' : ''}`} aria-label="Code">
        <div className="overview-head">
          <h3>{hasCopies ? 'What this task changes' : 'Code'}</h3>
          {(hasCopies || !task.isolated) && (
            <button className="quiet" disabled={editor.busy} onClick={() => void editor.run(async () => void (await api.openTaskInEditor(task.id)))}>
              <ExternalLink size={14} />
              {editorName ? `Open in ${editorName}` : 'Open in editor'}
            </button>
          )}
        </div>
        {hasCopies && (
          <ul className="overview-repos">
            {task.worktrees.map((worktree) => {
              const report = repos.find((repo) => repo.projectId === worktree.projectId);
              return (
                <li key={worktree.projectId}>
                  <strong>{repoName(worktree.projectId)}</strong>
                  <span className="hint">
                    {worktree.branch}, from {baseLabel(worktree.base)}
                  </span>
                  <span className="hint">{report ? changeSummary(report) : 'No changes yet'}</span>
                  <button className="quiet" title={worktree.path} disabled={editor.busy} onClick={() => void editor.run(() => api.openTaskWorktree(task.id, worktree.projectId))}>
                    <FolderOpen size={14} />
                    Open folder
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {!hasCopies && <p className="hint">{task.isolated ? 'Nothing changed yet. When the agent needs to change a repository, it makes a copy on a new branch.' : 'This task works in the client’s shared folder.'}</p>}
        {task.isolated && reading.length > 0 && <p className="hint">Only reading: {reading.map((project) => project.name).join(', ')}</p>}
        {repos.length > 0 && (
          <button className="quiet overview-link" onClick={onOpenDetails}>
            View changes
          </button>
        )}
        {editor.error && <p className="error">{editor.error}</p>}
      </section>
      )}

      {hasPulls && (
        <section className="overview-card overview-wide" aria-label="Pull requests">
          <h3>Pull requests</h3>
          <TaskPullRequests task={task} review={review} onChanged={onChanged} onGiven={onOpenTerminal} />
        </section>
      )}
    </div>
  );
}
