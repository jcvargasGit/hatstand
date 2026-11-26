import { z } from 'zod';

const envelopeSchema = z.looseObject({
  result: z.string().optional(),
  is_error: z.boolean().optional(),
});

/** What one `claude -p --output-format json` run printed: the JSON of its answer, or why there is none. */
export type AgentResult = { ok: true; reply: unknown } | { ok: false; problem?: string };

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function replyJson(result: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(result)?.[1];
  const direct = parseJson((fenced ?? result).trim());
  if (direct !== undefined) return direct;
  const start = result.indexOf('{');
  const end = result.lastIndexOf('}');
  return start >= 0 && end > start ? parseJson(result.slice(start, end + 1)) : undefined;
}

export function readAgentResult(stdout: string): AgentResult {
  const envelope = envelopeSchema.safeParse(parseJson(stdout.trim()));
  if (!envelope.success) return { ok: false };
  const { result = '', is_error: failed } = envelope.data;
  if (failed) return { ok: false, problem: `The agent could not finish: ${result.trim() || 'no reason given'}.` };
  return { ok: true, reply: replyJson(result) };
}
