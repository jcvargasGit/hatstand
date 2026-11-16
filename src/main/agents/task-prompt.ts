import type { ActivePlanning } from '../active-folders';
import type { ClientLink, Company, GitIdentity, Project, Subdomain, Task, TaskGuide, TaskType } from '../../shared/schemas';
import { singleLine } from './prompt-prefill';
import { STEP_DONE_COMMAND } from '../step-done-tool';
import { CHECK_PLAN_COMMAND } from '../check-plan-tool';
import type { BacklogPromptInput } from '../backlog-plan';
import { taskTypeName, taskTypeOf } from '../../shared/task-types';
import { workRepositories } from '../../shared/work-repos';

const COMMITS_RESULTS: (TaskType | undefined)[] = ['planning', 'design'];

export type TaskPromptInput = {
  company: Company;
  task: Task;
  area?: Subdomain;
  repositories: Project[];
  subdomainFolders?: string[];
  areaFolder?: string;
  companyInstructions: string;
  knowledgeDirs: string[];
  planning?: ActivePlanning;
  notesFile: string;
  notes: string;
  backlog?: BacklogPromptInput;
};

type PlanningUse = 'commits' | 'saves' | 'reads';

function planningSection({ path, places, hasGit }: ActivePlanning, use: PlanningUse): string[] {
  if (use === 'reads') {
    return [
      `## ${hasGit ? 'Planning repository' : 'Planning folder'}`,
      `Plans, tickets, specs and decisions for this client live in ${path}. Read them for context.`,
      'The plan of this task is not saved there. Do not change anything in this folder.',
      '',
    ];
  }
  if (!hasGit) {
    return [
      '## Planning folder',
      `Plans, tickets, specs and decisions for this client live in ${path}. This folder has no git, so nothing there needs a commit.`,
      ...(places.length > 0 ? ['Where each thing goes:', ...places.map((place) => `- ${place.name}: ${place.folder}`)] : []),
      'Save lasting work there. Task notes stay your working draft, and they should link to the file you saved.',
      '',
    ];
  }
  return [
    '## Planning repository',
    `Plans, tickets, specs and decisions for this client live in ${path}. Read what is there and follow its conventions.`,
    ...(places.length > 0 ? ['Where each thing goes:', ...places.map((place) => `- ${place.name}: ${place.folder}`)] : []),
    'Save lasting work there. Task notes stay your working draft, and they should link to the file you saved.',
    use === 'commits'
      ? 'Commit the result of this task in this repository before you write done in the notes, because that commit is what finishes it. Do not push or open a pull request here unless the person asks.'
      : 'Do not commit, push or open a pull request in this repository unless the person asks.',
    '',
  ];
}

function codeSection(company: Company, task: Task, repositories: Project[]): string[] {
  if (!task.isolated) return [];
  const workRepos = workRepositories(company);
  if (workRepos.length === 0) return [];
  const active = task.worktrees.filter((worktree) => repositories.some((repo) => repo.id === worktree.projectId));
  const others = workRepos.filter((repo) => !repositories.some((item) => item.id === repo.id));
  return [
    '## Reading and changing code',
    'The repositories of this task show you where this work lives. Their original folders are only for reading: do not edit files or commit there.',
    ...(others.length > 0 ? [`This client also has: ${others.map((repo) => repo.name).join(', ')}. Read them if you need to.`] : []),
    'Before you change a repository, run this command with its exact name: hatstand-edit-repo "<repository name>"',
    'It creates a copy on a branch of this task, and prints its folder. Then work and commit only in that folder, and stay on that branch.',
    ...(active.length > 0 ? ['Copies you already have:', ...active.map((worktree) => `- ${worktree.path} on branch ${worktree.branch}, started from ${worktree.base}`)] : []),
    'A copy starts without installed dependencies or ignored files such as .env. Install what you need before running anything.',
    '',
  ];
}

function readOnlyCodeSection(company: Company): string[] {
  const workRepos = workRepositories(company);
  return [
    '## This task does not change code',
    ...(workRepos.length > 0
      ? [`Read the repositories of this client to judge the order and the conflicts between tasks: ${workRepos.map((repo) => `${repo.name} (${repo.path})`).join(', ')}.`]
      : []),
    'Use only read-only commands. Do not edit files, install dependencies, create branches or copies, commit, push or open pull requests. Do not create, change or close tasks, tickets or issues.',
    '',
  ];
}

const itemLine = (item: Task) => `#${item.number ?? '?'} ${item.title}${item.priority === 'none' ? '' : ` (priority ${item.priority})`}`;

function backlogSection({ planFile, items, schema }: BacklogPromptInput): string[] {
  const details = items.flatMap((item) => [
    `### ${itemLine(item)}`,
    ...(item.description.trim() ? [item.description.trim()] : ['No details.']),
    ...(item.checklist.length > 0 ? ['Checklist:', ...item.checklist.map((entry) => `- [${entry.done ? 'x' : ' '}] ${entry.text}`)] : []),
    '',
  ]);
  return [
    '## Backlog to plan',
    `The person selected these ${items.length === 1 ? 'backlog task' : `${items.length} backlog tasks`}, in their current backlog order, and asks for an implementation plan. It is a proposal: the person edits and approves it, and approving it does not start any work.`,
    '',
    ...details,
    '## How to write the plan',
    `Write the plan as JSON to ${planFile}. Write only that file for the plan: not the planning folder, not a repository, not the notes.`,
    'Refer to each task by its number, written as a JSON number: 12 for #12.',
    'Decide, for each task:',
    '- order: the tasks you can plan, in the order to build them. Give the reason for each position.',
    '- dependsOn: the tasks that must be finished before a task starts. They must come earlier in the order.',
    '- notInParallel: groups of tasks in the order that must not be developed at the same time, such as tasks that change the same files, the same database migration or the same shared environment. Give the reason.',
    '- outOfScope: the tasks that need a decision from the person before they can be planned, such as an unclear scope, a product choice, a missing access or a conflict with another task. Write the decision needed as a question. Do not guess an answer.',
    'Put every selected task either in order or in outOfScope, once. Use only the numbers listed above. A task that depends on a task out of scope goes out of scope too.',
    `The file must match this JSON Schema: ${schema}`,
    `After you write it, run ${CHECK_PLAN_COMMAND}. It validates the file as Hatstand will, and lists what to fix. Fix it and run it again until it says the plan is valid.`,
    'Then summarize the plan for the person, and write done in the notes.',
    '',
  ];
}

function checklistSection({ checklist }: Task): string[] {
  if (checklist.length === 0) return [];
  return ['## Checklist for this task', ...checklist.map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`), ''];
}

function areaSection(area: Subdomain, folder: string | undefined): string[] {
  return [
    '## Area',
    `This task belongs to the area "${area.name}" of this client.`,
    ...(area.description ? [area.description] : []),
    ...(folder ? [`Its private files are in ${folder}. Read Instructions.md and Tips.md there before you start, and follow them. Save what you learn in Notes.md.`] : []),
    '',
  ];
}

function linksSection(links: ClientLink[]): string[] {
  if (links.length === 0) return [];
  return ['## Links for this work', ...links.map((link) => `- ${link.label}: ${link.url}`), ''];
}

function identitySection(identity: GitIdentity | undefined): string[] {
  if (!identity) return [];
  return [
    '## Who commits',
    `Commits for this client are made as ${identity.name} <${identity.email}>.${identity.githubUser ? ` The GitHub user is ${identity.githubUser}.` : ''}`,
    'This is already set up. Do not change the git configuration, and do not use another account for this client.',
    '',
  ];
}

function implementationSection(): string[] {
  return [
    '## How implementation work goes',
    'Check first whether this work already exists. Then plan, implement with tests, check each acceptance criterion, and commit following this client\'s rules.',
    'Ask before each push and before opening a pull request. Copilot reviews after the pull request is open. Fix each comment, or reply with the evidence when it is wrong, until nothing is open.',
    'When nothing is open, say the pull request is waiting for the person to merge it. Do not merge it, and do not mark the task done before it is merged.',
    '',
  ];
}

function guideSection(guide: TaskGuide): string[] {
  const steps = guide.steps.map((step, index) => `${index + 1}. ${step.name}${step.you ? ' (the person does this)' : ''}${step.approval ? ' (needs approval)' : ''}`);
  return [
    '## Guide for this task',
    `This task follows the guide "${guide.name}":`,
    ...steps,
    'The person sends you one step at a time. Do only the step you receive, then stop and report.',
    'Do not start a step marked "needs approval" until the person sends it. That step acts outside this computer.',
    '',
  ];
}

export function buildSystemPrompt(input: TaskPromptInput): string {
  const { company, task, area, repositories, subdomainFolders = [], areaFolder, companyInstructions, knowledgeDirs, planning, notesFile, notes, backlog } = input;
  const type = taskTypeOf(task, company);
  const planningUse: PlanningUse = backlog ? 'reads' : COMMITS_RESULTS.includes(type) ? 'commits' : 'saves';
  const location = [
    `Client: ${company.name}`,
    repositories.length > 0 ? `Repositories for this task:\n${repositories.map((repo) => `- ${repo.name} (${repo.path})`).join('\n')}` : null,
    subdomainFolders.length > 0 ? `Folders of this area. Work here first, and look elsewhere in the repository only when you need to:\n${subdomainFolders.map((folder) => `- ${folder}`).join('\n')}` : null,
  ].filter((line): line is string => line !== null);

  return [
    '# Hatstand workspace',
    ...location,
    '',
    '## Current task',
    task.source ? `${task.source.key}: ${task.title}` : task.title,
    ...(type ? [`Type: ${taskTypeName(type)}`] : []),
    task.description,
    '',
    ...checklistSection(task),
    ...(backlog ? backlogSection(backlog) : []),
    ...(area ? areaSection(area, areaFolder) : []),
    ...linksSection([...company.links, ...(area?.links ?? [])]),
    '## Task notes',
    `The notes file is ${notesFile}. It is how this task continues later, possibly with another agent.`,
    'Keep it current before you finish every turn. Start the file with these four sections, with these exact headings, and write their content in the language of the conversation:',
    '## TL;DR',
    'One or two sentences: what this task achieves and where it is now.',
    '## Last done',
    'The last thing that was done.',
    '## Pending',
    'What is left and who has to do it. Write only "Nothing" when nothing is left.',
    '## Status',
    'One of: in progress, done. Hatstand reads this. Write done when nothing is left for you to do. It does not close the task: the person does that. If this task changes code, Hatstand treats it as finished only when the work is in the main branch, so done alone is not enough.',
    'After those sections, keep decisions and other details under your own headings.',
    notes ? `Current notes:\n${notes}` : 'There are no notes yet.',
    '',
    '## Finishing a guide step',
    `When a prompt from the person starts with "Step N of M", run this command with that N as your last action, once you have finished what the step asks and no question or decision of yours blocks moving on: ${STEP_DONE_COMMAND} N`,
    'Do not run it if you are midway, if you are waiting for an answer, or if the step needs an approval you do not have yet. It only turns on the Next step button. The person still decides when to move on.',
    '',
    '## Documents for the person',
    `When this task produces a document the person should read, such as a report or a draft, save it next to the notes as ${notesFile.replace(/\.md$/, '')}.<short-name>.md, unless it belongs in the planning folder. Hatstand shows these files in the task under Agent output.`,
    '',
    '## Keep client data out of git',
    knowledgeDirs.length > 0
      ? `Client knowledge is in: ${knowledgeDirs.join(', ')}. Read it when useful.`
      : 'This client has no knowledge folder.',
    'Never copy client knowledge or secret values into a repository, a commit, or a pull request.',
    'Never bypass git hooks with --no-verify.',
    '',
    ...(backlog ? readOnlyCodeSection(company) : codeSection(company, task, repositories)),
    ...identitySection(company.gitIdentity),
    ...(planning ? planningSection(planning, planningUse) : []),
    ...(task.guide ? guideSection(task.guide) : type === 'implementation' ? implementationSection() : []),
    ...(companyInstructions ? ['## Client instructions', companyInstructions] : []),
  ].join('\n');
}

const focusText = (focus: string[]) => (focus.length > 0 ? ` Focus on ${focus.join(', ')}.` : '');

export function buildInitialPrompt(task: Task, focus: string[]): string {
  return singleLine(
    `Review the task "${task.title}" and its notes.${focusText(focus)} Tell me where it stands and what you propose to do next. Do not change anything except the task notes until I confirm.`,
  );
}

export function buildStepPrompt(task: Task, focus: string[]): string | null {
  const guide = task.guide;
  const step = guide?.steps[guide.current];
  if (!guide || !step?.prompt) return null;
  const values: Record<string, string> = {
    task: task.title,
    ticket: task.source?.key ?? task.title,
    link: task.source?.url ?? 'see the task description',
  };
  const text = step.prompt.replace(/\{(task|ticket|link)\}/g, (_match, key: string) => values[key] ?? '');
  return singleLine(`Step ${guide.current + 1} of ${guide.steps.length}, ${step.name}: ${text}${focusText(focus)}`);
}

export function buildBacklogPrompt(task: Task): string {
  const count = task.backlogPlan?.items.length ?? 0;
  return singleLine(
    `Read the ${count === 1 ? 'backlog task' : `${count} backlog tasks`} listed in your instructions under "Backlog to plan", and the code and documents they touch, using read-only commands. Then propose the implementation plan: write it to the plan file and check it with ${CHECK_PLAN_COMMAND}. Do not change any code.`,
  );
}

export function openingPrompt(task: Task, focus: string[], resume: boolean): string | null {
  if (task.backlogPlan && !task.guide) return resume ? null : buildBacklogPrompt(task);
  if (task.guide) return !resume || task.guide.promptPending ? buildStepPrompt(task, focus) : null;
  return resume ? null : buildInitialPrompt(task, focus);
}
