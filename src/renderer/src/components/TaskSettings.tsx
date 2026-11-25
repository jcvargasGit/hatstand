import { useState } from 'react';
import type { PlaybookSummary, Snapshot } from '../../../shared/api';
import type { Company, Task, TaskPatch } from '../../../shared/schemas';
import { TASK_TYPE_CHOICES, taskTypeName, taskTypeOf } from '../../../shared/task-types';
import { choicesOf, type TaskChoices } from '../lib/task-form';
import { ChangeClient } from './ChangeClient';
import { GuideStepSelect } from './GuideStepSelect';
import { TaskForm } from './TaskForm';
import { TaskIssueLink } from './TaskIssueLink';
import { TaskRepositories } from './TaskRepositories';
import { TaskSettingsFields } from './TaskSettingsFields';

type TaskSettingsProps = {
  snapshot: Snapshot;
  task: Task;
  company: Company;
  playbooks: PlaybookSummary[];
  isLive: boolean;
  effectiveAccountId?: string;
  patch: (change: TaskPatch) => unknown;
  onGuideChange: (playbookId: string | null) => unknown;
  onChanged: () => Promise<void>;
};

/** What a task is set up with, in the same form as a new task: description, type, guide, area, repositories and code. Each change saves at once. */
export function TaskSettings({ snapshot, task, company, playbooks, isLive, effectiveAccountId, patch, onGuideChange, onChanged }: TaskSettingsProps) {
  const [description, setDescription] = useState(task.description);
  const choices: TaskChoices = { ...choicesOf(task, snapshot), accountId: effectiveAccountId ?? '' };
  const typeFromGuide = taskTypeName(taskTypeOf({ ...task, type: undefined }, company));

  const change = (next: Partial<TaskChoices>) => {
    if (next.playbookId !== undefined) void onGuideChange(next.playbookId || null);
    if (next.areaId !== undefined) void patch({ subdomainId: next.areaId });
    if (next.accountId !== undefined) void patch({ accountId: next.accountId });
    if (next.priority !== undefined) void patch({ priority: next.priority });
    if (next.isolated !== undefined) void patch({ isolated: next.isolated });
    if (next.projectIds !== undefined) void patch({ projectIds: next.projectIds });
  };

  return (
    <div className="task-settings-view">
      <TaskForm
        label="Task settings"
        description={description}
        improveRequest={{ key: task.id, companyId: task.companyId, title: task.title, description, subdomainId: task.subdomainId, projectIds: task.projectIds, accountId: task.accountId }}
        onDescriptionChange={setDescription}
        onDescriptionCommit={(text) => {
          if (text !== task.description) void patch({ description: text });
        }}
        below={<TaskRepositories task={task} company={company} isLive={isLive} onChanged={onChanged} />}
        settings={
          <TaskSettingsFields
            snapshot={snapshot}
            company={company}
            choices={choices}
            playbooks={playbooks}
            lead={<ChangeClient snapshot={snapshot} task={task} onChanged={onChanged} />}
            changing={task.worktrees.map((worktree) => worktree.projectId)}
            note={isLive ? 'Changes to the agent or repositories apply to the next session.' : undefined}
            guideStep={task.guide && <GuideStepSelect task={task} guide={task.guide} onChanged={onChanged} />}
            onChange={change}
            onAreaCreated={(subdomainId) => patch({ subdomainId })}
          >
            <label className="stacked-field">
              Type
              <select value={task.type ?? ''} onChange={(event) => void patch({ type: TASK_TYPE_CHOICES.find((choice) => choice.type === event.target.value)?.type })}>
                <option value="">{typeFromGuide ? `From the guide (${typeFromGuide})` : 'Not set'}</option>
                {TASK_TYPE_CHOICES.map((choice) => (
                  <option key={choice.type} value={choice.type}>
                    {choice.name}
                  </option>
                ))}
              </select>
            </label>
            <TaskIssueLink task={task} onChanged={onChanged} />
          </TaskSettingsFields>
        }
      />
    </div>
  );
}
