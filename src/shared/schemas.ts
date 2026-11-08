import { z } from 'zod';

z.config({ jitless: true });

export const accountSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  type: z.enum(['claude-code', 'github-copilot']),
  label: z.enum(['personal', 'company']),
  configDir: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  companyId: z.string().min(1).optional(),
});

export const accountsFileSchema = z.object({
  defaultAccountId: z.string().optional(),
  accounts: z.array(accountSchema),
});

export const subdomainFolderSchema = z.object({
  projectId: z.string().min(1),
  path: z
    .string()
    .trim()
    .min(1)
    .refine((path) => !path.startsWith('/') && !path.split('/').includes('..'), 'Write a folder inside the repository.'),
});

const isWebUrl = (value: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

export const clientLinkSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1, 'Name this link.'),
  url: z.string().trim().refine(isWebUrl, 'Write a web address, starting with https://.'),
});

export const subdomainSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, 'Name this area.'),
  folder: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'Use lowercase letters, numbers and dashes for the folder.').optional(),
  description: z.string().default(''),
  folders: z.array(subdomainFolderSchema).default([]),
  links: z.array(clientLinkSchema).default([]),
});

export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  path: z.string().min(1),
  subdomainId: z.string().optional(),
  splitByFolder: z.boolean().optional(),
});

export const stayAwakeModeSchema = z.enum(['off', 'sessions', 'always']);
export const todayLayoutSchema = z.enum(['list', 'board']);

export const preferencesSchema = z.object({
  stayAwake: stayAwakeModeSchema.default('off'),
  clientOrder: z.array(z.string()).default([]),
  todayLayout: todayLayoutSchema.default('list'),
  guideNewTasks: z.boolean().default(true),
});

export const planningPlaceSchema = z.object({
  name: z.string().trim().min(1),
  folder: z.string().trim().min(1),
});

export const pastFolderSchema = z.object({
  section: z.enum(['knowledge', 'llm-config', 'planning']),
  path: z.string().min(1),
  leftAt: z.string(),
});

export const planningRepoSchema = z.object({
  path: z.string().min(1),
  places: z.array(planningPlaceSchema).default([]),
});

function fromFolderLists(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const { knowledgeDirs, pluginDirs, ...context } = raw as Record<string, unknown>;
  const first = (list: unknown) => (Array.isArray(list) && list.length > 0 ? { value: list[0] } : null);
  const knowledge = first(knowledgeDirs);
  const plugin = first(pluginDirs);
  return {
    ...context,
    ...(knowledge && context.knowledgeDir === undefined ? { knowledgeDir: knowledge.value } : {}),
    ...(plugin && context.pluginDir === undefined ? { pluginDir: plugin.value } : {}),
  };
}

export const companyContextSchema = z.preprocess(
  fromFolderLists,
  z.object({
    instructionsFile: z.string().optional(),
    knowledgeDir: z.string().optional(),
    pluginDir: z.string().optional(),
    mcpConfigFile: z.string().optional(),
  }),
);

export const clientPhotoSchema = z.object({
  sourceUrl: z.string().min(1),
  type: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  savedAt: z.string(),
});

export const gitSourceSchema = z.object({
  provider: z.enum(['github', 'gitlab']),
  owner: z.string().trim().min(1, 'Write the organization, group or user.'),
  host: z.string().trim().optional(),
});


export const gitIdentityInputSchema = z.object({
  name: z.string().trim().min(1, 'Write the name for your commits.'),
  email: z.email('Write the email for your commits.'),
  githubUser: z.string().trim().optional(),
  folder: z.string().trim().min(1, 'Choose the folder this identity applies to.'),
});

export const gitIdentitySchema = gitIdentityInputSchema.extend({ appliedAt: z.string().optional() });

export const workPeriodSchema = z.object({
  every: z.number().int('Write a whole number.').min(1, 'A period lasts at least 1.').max(366, 'Use a shorter period.'),
  unit: z.enum(['days', 'weeks', 'months']),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the date of the first period.'),
});

export const assistantStopSchema = z.enum(['commit', 'pull-request']);

export const assistantRunSchema = z.object({
  parallel: z.number().int().min(1).max(10).default(2),
  stopAt: assistantStopSchema.default('commit'),
});

export const companySchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  photo: clientPhotoSchema.optional(),
  rootDir: z.string().optional(),
  defaultAccountId: z.string().optional(),
  defaultPlaybookId: z.string().optional(),
  origin: z.enum(['scratch', 'existing']).default('existing'),
  hasCode: z.boolean().default(true),
  confirmedSteps: z.array(z.string()).transform((steps) => steps.map((step) => (step === 'skills' ? 'llm-config' : step))).default([]),
  gitSource: gitSourceSchema.optional(),
  skipPermissions: z.boolean().default(false),
  assistantRun: assistantRunSchema.optional(),
  protectedPaths: z.array(z.string()).default([]),
  subdomains: z.array(subdomainSchema).default([]),
  defaultAreaId: z.string().optional(),
  projects: z.array(projectSchema).default([]),
  context: companyContextSchema.default({}),
  planning: planningRepoSchema.optional(),
  pastFolders: z.array(pastFolderSchema).optional(),
  links: z.array(clientLinkSchema).default([]),
  workPeriod: workPeriodSchema.optional(),
  gitIdentity: gitIdentitySchema.optional(),
  archivedAt: z.string().optional(),
});

export const taskSourceSchema = z.object({
  kind: z.enum(['jira', 'github', 'gitlab']),
  key: z.string().min(1),
  url: z.string().optional(),
  status: z.string().optional(),
});

export const taskStatusSchema = z.enum(['idea', 'todo', 'doing', 'done']);
export const taskTypeSchema = z.enum(['implementation', 'pr-review', 'investigation', 'design', 'planning', 'testing', 'release', 'report']);
export const boardLaneSchema = z.enum(['next', 'needs-you', 'in-review', 'ready', 'merged']);

export const taskWorktreeSchema = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1),
  branch: z.string().min(1),
  base: z.string().min(1),
  baseCommit: z.string().optional(),
});

export const taskPrioritySchema = z.enum(['none', 'low', 'medium', 'high']);

export const checklistItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().trim().min(1),
  done: z.boolean().default(false),
});

export const ideaSchema = z.object({
  title: z.string().trim().min(1, 'Write something to keep.'),
  description: z.string().default(''),
  checklist: z.array(z.string().trim().min(1)).default([]),
});

export const failedCheckSchema = z.object({
  name: z.string(),
  url: z.string().optional(),
  detail: z.string().optional(),
  jobId: z.string().optional(),
});

export const reviewCommentSchema = z.object({
  id: z.string(),
  author: z.string(),
  body: z.string(),
  url: z.string().optional(),
  file: z.string().optional(),
  line: z.number().optional(),
  resolvable: z.boolean().optional(),
});

export const pullRequestSchema = z.object({
  projectId: z.string(),
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.enum(['open', 'merged', 'closed']),
  draft: z.boolean(),
  headSha: z.string(),
  ci: z.enum(['passing', 'failing', 'running', 'none']),
  review: z.enum(['approved', 'changes-requested', 'none']),
  reviewRequired: z.boolean().optional(),
  copilot: z.enum(['pending', 'reviewed']).optional(),
  conflicts: z.boolean(),
  intoMain: z.boolean().optional(),
  failedChecks: z.array(failedCheckSchema),
  comments: z.array(reviewCommentSchema),
});

export const branchFactSchema = z.object({
  projectId: z.string(),
  hasWork: z.boolean(),
  inMain: z.boolean(),
  clean: z.boolean(),
});

export const taskReviewSchema = z.object({
  pulls: z.array(pullRequestSchema),
  branches: z.array(branchFactSchema).optional(),
  error: z.string().optional(),
  checkedAt: z.string(),
  feedbackKey: z.string().optional(),
});

export const playbookStepSchema = z
  .object({
    name: z.string().trim().min(1),
    prompt: z.string().trim().min(1).optional(),
    you: z.string().trim().min(1).optional(),
    approval: z.boolean().optional(),
  })
  .refine((step) => (step.prompt === undefined) !== (step.you === undefined), 'Give each step either a prompt for the agent or a you text for the person, not both.');

export const playbookSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  type: taskTypeSchema.optional(),
  steps: z.array(playbookStepSchema).min(1, 'A guide needs at least one step.').max(30),
});

export const taskGuideSchema = z.object({
  playbookId: z.string().min(1),
  name: z.string().min(1),
  type: taskTypeSchema.optional(),
  steps: z.array(playbookStepSchema).min(1),
  current: z.number().int().min(0),
  promptPending: z.boolean(),
});

export const backlogPlanApprovalSchema = z.object({
  approvedAt: z.string(),
  digest: z.string().min(1),
});

export const backlogPlanItemSchema = z.object({
  id: z.string().min(1),
  number: z.number().int().positive(),
});

export const backlogPlanLinkSchema = z.object({
  items: z.array(backlogPlanItemSchema).min(1),
  approval: backlogPlanApprovalSchema.optional(),
});

export const taskSchema = z.object({
  id: z.string().min(1),
  number: z.number().int().positive().optional(),
  companyId: z.string().min(1),
  title: z.string().trim().min(1),
  customTitle: z.boolean().optional(),
  description: z.string().default(''),
  note: z.string().default(''),
  status: taskStatusSchema,
  type: taskTypeSchema.optional(),
  doneAt: z.string().optional(),
  subdomainId: z.string().optional(),
  projectIds: z.array(z.string()).default([]),
  accountId: z.string().optional(),
  source: taskSourceSchema.optional(),
  guide: taskGuideSchema.optional(),
  backlogPlan: backlogPlanLinkSchema.optional(),
  checklist: z.array(checklistItemSchema).default([]),
  priority: taskPrioritySchema.default('none'),
  rank: z.number().optional(),
  boardLane: boardLaneSchema.optional(),
  isolated: z.boolean().default(false),
  worktrees: z.array(taskWorktreeSchema).default([]),
  feedbackSent: z.string().optional(),
  agentStatus: z.string().optional(),
  archivedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const newTaskSchema = z.object({
  companyId: z.string().min(1),
  title: z.string().trim().min(1, 'Write a task title.'),
  description: z.string().optional(),
  subdomainId: z.string().optional(),
  projectIds: z.array(z.string()).optional(),
  accountId: z.string().optional(),
  playbookId: z.string().optional(),
  checklist: z.array(z.string()).optional(),
  rank: z.number().optional(),
  isolated: z.boolean().optional(),
});

export const taskPatchSchema = z
  .object({
    title: z.string().trim().min(1),
    customTitle: z.boolean(),
    description: z.string(),
    status: taskStatusSchema,
    type: taskTypeSchema,
    subdomainId: z.string(),
    projectIds: z.array(z.string()),
    accountId: z.string(),
    archivedAt: z.string(),
    guide: taskGuideSchema,
    isolated: z.boolean(),
    checklist: z.array(checklistItemSchema),
    priority: taskPrioritySchema,
    rank: z.number(),
    boardLane: boardLaneSchema,
  })
  .partial();

export const sessionStateSchema = z.enum(['working', 'background', 'needs-input', 'idle', 'stopped']);

export const sessionSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().min(1),
  companyId: z.string().min(1),
  accountId: z.string().min(1),
  cwd: z.string().min(1),
  state: sessionStateSchema,
  draft: z.boolean().optional(),
  stepDone: z.number().int().positive().optional(),
  startedAt: z.string(),
  updatedAt: z.string(),
});

export const subagentRunSchema = z.object({
  id: z.string(),
  type: z.string(),
  description: z.string(),
  state: z.enum(['running', 'finished', 'stopped']),
  summary: z.string().optional(),
});

export const secretNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Use letters, numbers and underscores, starting with a letter.');

export type ClientLink = z.infer<typeof clientLinkSchema>;
export type GitIdentityInput = z.infer<typeof gitIdentityInputSchema>;
export type GitIdentity = z.infer<typeof gitIdentitySchema>;
export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export type ChecklistItem = z.infer<typeof checklistItemSchema>;
export type TaskWorktree = z.infer<typeof taskWorktreeSchema>;
export type Idea = z.input<typeof ideaSchema>;
export type FailedCheck = z.infer<typeof failedCheckSchema>;
export type ReviewComment = z.infer<typeof reviewCommentSchema>;
export type PullRequest = z.infer<typeof pullRequestSchema>;
export type BranchFact = z.infer<typeof branchFactSchema>;
export type TaskReview = z.infer<typeof taskReviewSchema>;
export type Playbook = z.infer<typeof playbookSchema>;
export type PlaybookStep = z.infer<typeof playbookStepSchema>;
export type TaskGuide = z.infer<typeof taskGuideSchema>;
export type SubagentRun = z.infer<typeof subagentRunSchema>;
export type Account = z.infer<typeof accountSchema>;
export type AccountsFile = z.infer<typeof accountsFileSchema>;
export type Subdomain = z.infer<typeof subdomainSchema>;
export type StayAwakeMode = z.infer<typeof stayAwakeModeSchema>;
export type TodayLayout = z.infer<typeof todayLayoutSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;
export type Project = z.infer<typeof projectSchema>;
export type PlanningPlace = z.infer<typeof planningPlaceSchema>;
export type PlanningRepo = z.infer<typeof planningRepoSchema>;
export type PastFolderRecord = z.infer<typeof pastFolderSchema>;
export type ClientPhoto = z.infer<typeof clientPhotoSchema>;
export type GitSource = z.infer<typeof gitSourceSchema>;
export type Company = z.infer<typeof companySchema>;
export type Task = z.infer<typeof taskSchema>;
export type BacklogPlanLink = z.infer<typeof backlogPlanLinkSchema>;
export type AssistantRun = z.infer<typeof assistantRunSchema>;

export const assistantRunOf = (company: Company): AssistantRun => assistantRunSchema.parse(company.assistantRun ?? {});
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskType = z.infer<typeof taskTypeSchema>;
export type WorkPeriod = z.infer<typeof workPeriodSchema>;
export type TaskSource = z.infer<typeof taskSourceSchema>;
export type NewTask = z.infer<typeof newTaskSchema>;
export type TaskPatch = z.infer<typeof taskPatchSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type SessionState = z.infer<typeof sessionStateSchema>;

export const releaseStateSchema = z.object({
  state: z.enum(['building', 'waiting', 'installed', 'failed']),
  version: z.string(),
  message: z.string().optional(),
  pid: z.number(),
});
export type ReleaseState = z.infer<typeof releaseStateSchema>;
