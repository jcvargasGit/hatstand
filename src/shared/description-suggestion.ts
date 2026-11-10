import { z } from 'zod';

export const SUGGESTION_TIMEOUT_MS = 5 * 60_000;

export const suggestionRequestSchema = z
  .object({
    key: z.string().min(1),
    companyId: z.string().min(1),
    title: z.string().trim().default(''),
    description: z.string().default(''),
    subdomainId: z.string().optional(),
    projectIds: z.array(z.string()).default([]),
    accountId: z.string().optional(),
  })
  .refine((request) => request.title !== '' || request.description.trim() !== '', { message: 'Write a title or a description first.' });

export const suggestionReplySchema = z.object({
  description: z.string().trim().min(1, 'The agent returned an empty description.'),
});

const envelopeSchema = z.looseObject({
  result: z.string().optional(),
  is_error: z.boolean().optional(),
});

export type SuggestionRequest = z.input<typeof suggestionRequestSchema>;
export type DescriptionSuggestion = z.infer<typeof suggestionReplySchema>;
export type SuggestionParse = { ok: true; description: string } | { ok: false; problem: string };

const UNUSABLE = 'The agent did not return a description Hatstand can use. Try again.';

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

export function parseSuggestionOutput(stdout: string): SuggestionParse {
  const envelope = envelopeSchema.safeParse(parseJson(stdout.trim()));
  if (!envelope.success) return { ok: false, problem: UNUSABLE };
  const { result = '', is_error: failed } = envelope.data;
  if (failed) return { ok: false, problem: `The agent could not finish: ${result.trim() || 'no reason given'}.` };
  const reply = suggestionReplySchema.safeParse(replyJson(result));
  if (!reply.success) {
    const [issue] = reply.error.issues;
    return { ok: false, problem: issue?.code === 'too_small' ? issue.message : UNUSABLE };
  }
  return { ok: true, description: reply.data.description };
}
