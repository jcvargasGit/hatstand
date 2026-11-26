import { z } from 'zod';
import { taskStatusSchema, type Task, type TaskStatus } from './schemas';
import { readAgentResult } from './agent-output';
import { TASK_STATUS_WORDS } from './task-status-words';

export const CHAT_TIMEOUT_MS = 2 * 60_000;
export const MAX_CHAT_QUESTION = 2_000;
/** How many earlier turns go back to the agent with a new question. */
export const MAX_CHAT_HISTORY = 20;
/** How much of each description the agent reads. Titles and checklists always go whole. */
export const DESCRIPTION_CUT = 600;
/** How long the list of tasks can be, in characters, before older tasks lose their description. */
export const CONTEXT_LIMIT = 120_000;

export const chatTurnSchema = z.object({
  role: z.enum(['person', 'assistant']),
  text: z.string().trim().min(1),
});

export const chatRequestSchema = z.object({
  key: z.string().min(1),
  companyId: z.string().min(1),
  question: z.string().trim().min(1, 'Write a question first.').max(MAX_CHAT_QUESTION, `Keep the question under ${MAX_CHAT_QUESTION} characters.`),
  history: z.array(chatTurnSchema).default([]),
});

/** What the agent returns: its answer, and the references of the tasks it found related. */
export const chatReplySchema = z.object({
  answer: z.string().trim().min(1, 'The agent returned an empty answer.'),
  related: z.array(z.union([z.string(), z.number()]).transform(String)).default([]),
});

export const relatedTaskSchema = z.object({
  taskId: z.string(),
  number: z.number().optional(),
  title: z.string(),
  status: taskStatusSchema,
  archived: z.boolean(),
});

export const chatAnswerSchema = z.object({
  answer: z.string(),
  related: z.array(relatedTaskSchema),
});

export type ChatTurn = z.infer<typeof chatTurnSchema>;
export type ChatRequest = z.input<typeof chatRequestSchema>;
export type ChatReply = z.infer<typeof chatReplySchema>;
export type RelatedTask = z.infer<typeof relatedTaskSchema>;
export type ChatAnswer = z.infer<typeof chatAnswerSchema>;
export type ChatParse = { ok: true; reply: ChatReply } | { ok: false; problem: string };
export type TaskContext = { text: string; withoutDescription: number };

const UNUSABLE = 'The agent did not return an answer Hatstand can use. Try again.';
const STATUS_ORDER: TaskStatus[] = ['doing', 'todo', 'idea', 'done'];

/** How the agent names a task: its number, or its id when it has none. */
export const chatReference = (task: Pick<Task, 'id' | 'number'>): string => (task.number === undefined ? task.id : `#${task.number}`);

const lastChange = (task: Task): string => task.doneAt ?? task.updatedAt;

function cutDescription(description: string): string {
  const text = description.trim().replace(/\n{3,}/g, '\n\n');
  return text.length > DESCRIPTION_CUT ? `${text.slice(0, DESCRIPTION_CUT).trimEnd()}…` : text;
}

function taskBlock(task: Task, withDescription: boolean): string {
  const facts = [
    TASK_STATUS_WORDS[task.status],
    ...(task.archivedAt ? ['archived'] : []),
    ...(task.priority === 'none' ? [] : [`priority ${task.priority}`]),
    ...(task.doneAt ? [`finished on ${task.doneAt.slice(0, 10)}`] : []),
  ];
  const description = withDescription ? cutDescription(task.description) : '';
  return [
    `### ${chatReference(task)} ${task.title}`,
    `Status: ${facts.join(', ')}`,
    ...(task.checklist.length > 0 ? [`Checklist: ${task.checklist.map((item) => item.text).join('; ')}`] : []),
    ...(description ? description.split('\n').map((line) => `> ${line}`) : []),
  ].join('\n');
}

/**
 * The tasks of one client as the text the agent reads: in progress first, then to do, backlog and done.
 * Over the limit, the tasks that changed longest ago lose their description, finished ones first.
 */
export function buildTaskContext(tasks: Task[], limit = CONTEXT_LIMIT): TaskContext {
  const ordered = [...tasks].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || lastChange(b).localeCompare(lastChange(a)));
  const firstToShorten = [...ordered].sort((a, b) => Number(b.status === 'done') - Number(a.status === 'done') || lastChange(a).localeCompare(lastChange(b)));
  const shortened = new Set<string>();
  const render = () => ordered.map((task) => taskBlock(task, !shortened.has(task.id))).join('\n\n');
  let text = render();
  for (const task of firstToShorten) {
    if (text.length <= limit) break;
    if (!task.description.trim()) continue;
    shortened.add(task.id);
    text = render();
  }
  return { text: text || '(This client has no tasks yet.)', withoutDescription: shortened.size };
}

export function parseChatOutput(stdout: string): ChatParse {
  const result = readAgentResult(stdout);
  if (!result.ok) return { ok: false, problem: result.problem ?? UNUSABLE };
  const reply = chatReplySchema.safeParse(result.reply);
  if (!reply.success) {
    const [issue] = reply.error.issues;
    return { ok: false, problem: issue?.code === 'too_small' ? issue.message : UNUSABLE };
  }
  return { ok: true, reply: reply.data };
}

/** The real tasks behind the references of the agent. A reference to no task is dropped, and the status is the one of the task. */
export function resolveRelated(references: string[], tasks: Task[]): RelatedTask[] {
  const wanted = references.map((reference) => reference.trim().toLowerCase().replace(/^.*#/, ''));
  const found = wanted.flatMap((reference) => tasks.filter((task) => String(task.number) === reference || task.id.toLowerCase() === reference).slice(0, 1));
  return [...new Set(found)].map((task) => ({
    taskId: task.id,
    number: task.number,
    title: task.title,
    status: task.status,
    archived: Boolean(task.archivedAt),
  }));
}
