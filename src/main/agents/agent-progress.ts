import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { z } from 'zod';
import type { SessionState } from '../../shared/schemas';

const BACKGROUND_TOOLS = ['Bash', 'Agent', 'Task'];
const STOP_TOOLS = ['TaskStop', 'KillShell', 'KillBash'];
const TURN_END_SUBTYPES = ['stop_hook_summary', 'turn_duration'];
const TAIL_BYTES = 4 * 1024 * 1024;
export const BACKGROUND_LIMIT_MS = 30 * 60 * 1000;
export const QUIET_TURN_MS = 60 * 1000;

const blockSchema = z.object({
  type: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
  text: z.string().optional(),
  tool_use_id: z.string().optional(),
  content: z.unknown().optional(),
  input: z.looseObject({ run_in_background: z.unknown().optional(), task_id: z.string().optional(), shell_id: z.string().optional() }).optional(),
});
const entrySchema = z.object({
  type: z.string(),
  subtype: z.string().optional(),
  operation: z.string().optional(),
  isMeta: z.boolean().optional(),
  content: z.unknown().optional(),
  timestamp: z.string().optional(),
  message: z.object({ content: z.union([z.string(), z.array(blockSchema)]).optional() }).optional(),
});
const transcriptEventSchema = z.object({ transcript_path: z.string() });

export type AgentProgress = {
  pending: number;
  turnOpen: boolean;
  toolRunning: boolean;
  interrupted: boolean;
};

function parseLine<T>(schema: z.ZodType<T>, line: string): T | undefined {
  try {
    return schema.safeParse(JSON.parse(line)).data;
  } catch {
    return undefined;
  }
}

const firstText = (content: string | z.infer<typeof blockSchema>[] | undefined) => (typeof content === 'string' ? content : (content?.find((block) => block.type === 'text')?.text ?? ''));
const isCommandText = (text: string) => text.startsWith('<local-command') || text.startsWith('<command-');

export function readAgentProgress(transcript: string, startedAt: number, now: number): AgentProgress {
  const launched = new Map<string, number>();
  const results = new Map<string, string>();
  const running = new Set<string>();
  let turnOpen = false;
  let interrupted = false;

  const closeTurn = () => {
    turnOpen = false;
    running.clear();
  };

  for (const line of transcript.split('\n').filter(Boolean)) {
    const entry = parseLine(entrySchema, line);
    if (!entry) continue;
    const at = Date.parse(entry.timestamp ?? '');
    const current = at >= startedAt;
    if (entry.type === 'system' && TURN_END_SUBTYPES.includes(entry.subtype ?? '')) {
      closeTurn();
      continue;
    }
    const content = entry.message?.content;
    const queued = entry.type === 'queue-operation' && entry.operation === 'enqueue' && typeof entry.content === 'string' ? entry.content : null;
    const text = (queued ?? (entry.type === 'user' ? firstText(content) : '')).trim();
    if (text.startsWith('<task-notification')) {
      const id = /<tool-use-id>([^<]*)/.exec(text)?.[1];
      if (id) launched.delete(id);
      if (current) turnOpen = true;
      interrupted = false;
    } else if (text.startsWith('[Request interrupted')) {
      closeTurn();
      interrupted = current;
    } else if (current && entry.type === 'user' && !entry.isMeta && !isCommandText(text)) {
      turnOpen = true;
      interrupted = false;
    }
    if (current && entry.type === 'assistant') {
      turnOpen = true;
      interrupted = false;
    }
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        results.set(block.tool_use_id, JSON.stringify(block.content ?? ''));
        running.delete(block.tool_use_id);
      }
      if (block.type !== 'tool_use' || !block.name) continue;
      if (current && block.id) running.add(block.id);
      if (BACKGROUND_TOOLS.includes(block.name) && block.input?.run_in_background && block.id && current) launched.set(block.id, at);
      const stopped = STOP_TOOLS.includes(block.name) ? (block.input?.task_id ?? block.input?.shell_id) : undefined;
      if (stopped) {
        for (const id of [...launched.keys()]) {
          if (results.get(id)?.includes(stopped)) launched.delete(id);
        }
      }
    }
  }
  return {
    pending: [...launched.values()].filter((at) => now - at < BACKGROUND_LIMIT_MS).length,
    turnOpen,
    toolRunning: running.size > 0,
    interrupted,
  };
}

export function sessionStateFrom(reported: SessionState, progress: AgentProgress, transcriptAgeMs: number): SessionState {
  if (reported === 'needs-input' || reported === 'stopped') return reported;
  if (reported === 'working') {
    if (progress.interrupted) return 'idle';
    return !progress.turnOpen && progress.pending > 0 ? 'background' : 'working';
  }
  if (progress.turnOpen && (progress.toolRunning || transcriptAgeMs < QUIET_TURN_MS)) return 'working';
  return progress.pending > 0 ? 'background' : 'idle';
}

export function transcriptPathFrom(activity: string): string | undefined {
  for (const line of activity.split('\n').filter(Boolean).reverse()) {
    const event = parseLine(transcriptEventSchema, line);
    if (event) return event.transcript_path;
  }
  return undefined;
}

export function readTranscriptTail(file: string): string {
  const { size } = statSync(file);
  const length = Math.min(size, TAIL_BYTES);
  const buffer = Buffer.alloc(length);
  const handle = openSync(file, 'r');
  try {
    readSync(handle, buffer, 0, length, size - length);
  } finally {
    closeSync(handle);
  }
  return buffer.toString('utf8');
}
