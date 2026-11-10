import type { Company, Project, Subdomain } from '../../shared/schemas';

export type DescriptionPromptInput = {
  company: Company;
  area?: Subdomain;
  areaFolder?: string;
  repositories: Project[];
  knowledgeDir: string;
  companyInstructions: string;
  title: string;
  description: string;
};

export function buildDescriptionPrompt(input: DescriptionPromptInput): string {
  const { company, area, areaFolder, repositories, knowledgeDir, companyInstructions, title, description } = input;
  return [
    `You improve the description of a task for the client ${company.name}, before anyone works on it.`,
    '',
    '## Where to look',
    `- Client knowledge: ${knowledgeDir}`,
    ...(area ? [`- Area "${area.name}"${area.description ? `: ${area.description}` : ''}${areaFolder ? `. Its files are in ${areaFolder}` : ''}`] : []),
    ...repositories.map((repo) => `- Repository ${repo.name}: ${repo.path}`),
    'Read only what is relevant to this task. Use only Read, Grep and Glob. Do not change any file.',
    '',
    '## The task',
    `Title: ${title || '(no title)'}`,
    'Current description:',
    description.trim() || '(empty)',
    '',
    '## How to write the new description',
    '- Keep every fact and decision of the current description. Do not drop anything the person wrote.',
    '- Add what the code and the knowledge show: where the change goes, what it touches, and how to tell it is finished.',
    '- Do not invent requirements. When something is unclear, list it as an open question inside the description.',
    '- Write it in Markdown, in the language of the current description, unless the client instructions below ask for another language or format.',
    '- Describe only this task. Do not create subtasks or checklists, and do not change the title.',
    '- Never include secret values, keys or passwords.',
    ...(companyInstructions.trim() ? ['', '## Client instructions', 'Follow any task format they define.', companyInstructions.trim()] : []),
    '',
    '## Answer',
    'Answer with only this JSON and nothing else: {"description": "<the new description in Markdown>"}',
  ].join('\n');
}
