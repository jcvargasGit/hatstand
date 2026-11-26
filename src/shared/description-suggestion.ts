import { z } from 'zod';
import { readAgentResult } from './agent-output';
import { MAX_DESCRIPTION_INSTRUCTIONS } from './description-instructions';

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
    instructions: z.string().max(MAX_DESCRIPTION_INSTRUCTIONS, `Keep the prompt under ${MAX_DESCRIPTION_INSTRUCTIONS} characters.`).optional(),
  })
  .refine((request) => request.title !== '' || request.description.trim() !== '', { message: 'Write a title or a description first.' });

export const suggestionReplySchema = z.object({
  description: z.string().trim().min(1, 'The agent returned an empty description.'),
});

export type SuggestionRequest = z.input<typeof suggestionRequestSchema>;
export type DescriptionSuggestion = z.infer<typeof suggestionReplySchema>;
export type SuggestionParse = { ok: true; description: string } | { ok: false; problem: string };

const UNUSABLE = 'The agent did not return a description Hatstand can use. Try again.';

export function parseSuggestionOutput(stdout: string): SuggestionParse {
  const result = readAgentResult(stdout);
  if (!result.ok) return { ok: false, problem: result.problem ?? UNUSABLE };
  const reply = suggestionReplySchema.safeParse(result.reply);
  if (!reply.success) {
    const [issue] = reply.error.issues;
    return { ok: false, problem: issue?.code === 'too_small' ? issue.message : UNUSABLE };
  }
  return { ok: true, description: reply.data.description };
}
