import { z } from 'zod';
import type { SubagentRun } from '../../shared/schemas';

const MAX_SUMMARY_CHARS = 4000;
export const SESSION_RESTART_LINE = `${JSON.stringify({ hook_event_name: 'HatstandRestart' })}\n`;

const eventSchema = z.object({
  hook_event_name: z.string(),
  agent_id: z.string().optional(),
  agent_type: z.string().optional(),
  last_assistant_message: z.string().optional(),
  tool_input: z.object({ description: z.string().optional(), subagent_type: z.string().optional() }).optional(),
});

function parseLine(line: string) {
  try {
    return eventSchema.safeParse(JSON.parse(line)).data;
  } catch {
    return undefined;
  }
}

export function parseSubagentActivity(text: string): SubagentRun[] {
  const requested: { type: string; description: string }[] = [];
  const runs = new Map<string, SubagentRun>();
  for (const event of text.split('\n').filter(Boolean).map(parseLine)) {
    if (!event) continue;
    if (event.hook_event_name === 'HatstandRestart') {
      for (const run of endRunningSubagents([...runs.values()])) runs.set(run.id, run);
    }
    if (event.hook_event_name === 'PreToolUse') {
      requested.push({ type: event.tool_input?.subagent_type ?? 'general-purpose', description: event.tool_input?.description ?? '' });
    }
    const { agent_id: id, agent_type: type } = event;
    if (!id || !type) continue;
    if (event.hook_event_name === 'SubagentStart') {
      const match = requested.findIndex((item) => item.type === type);
      const [request] = match >= 0 ? requested.splice(match, 1) : [];
      runs.set(id, { id, type, description: request?.description ?? '', state: 'running' });
    }
    if (event.hook_event_name === 'SubagentStop') {
      const started = runs.get(id) ?? { id, type, description: '', state: 'running' as const };
      runs.set(id, { ...started, state: 'finished', summary: event.last_assistant_message?.slice(0, MAX_SUMMARY_CHARS) });
    }
  }
  return [...runs.values()];
}

export function endRunningSubagents(runs: SubagentRun[]): SubagentRun[] {
  return runs.map((run) => (run.state === 'running' ? { ...run, state: 'stopped' } : run));
}
