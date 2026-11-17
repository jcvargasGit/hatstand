import type { Subdomain } from './schemas';

export const MAX_DESCRIPTION_INSTRUCTIONS = 20_000;

export const DEFAULT_DESCRIPTION_INSTRUCTIONS = [
  '- Keep every fact and decision of the current description. Do not drop anything the person wrote.',
  '- Add what the code and the knowledge show: where the change goes, what it touches, and how to tell it is finished.',
  '- Do not invent requirements. When something is unclear, list it as an open question inside the description.',
  '- Write it in Markdown, in the language of the current description, unless the client instructions below ask for another language or format.',
  '- Describe only this task. Do not create subtasks or checklists, and do not change the title.',
  '- Never include secret values, keys or passwords.',
].join('\n');

export const descriptionInstructionsFor = (area?: Pick<Subdomain, 'descriptionPrompt'>): string =>
  area?.descriptionPrompt?.trim() ? area.descriptionPrompt : DEFAULT_DESCRIPTION_INSTRUCTIONS;

/** What an area stores for a prompt: nothing when it is blank or the same as the default. */
export const areaDescriptionPrompt = (text: string): string | undefined =>
  text.trim() === '' || text.trim() === DEFAULT_DESCRIPTION_INSTRUCTIONS ? undefined : text;
