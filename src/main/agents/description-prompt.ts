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
  /** How the person wants the description written. Blank leaves the section out. */
  instructions: string;
};

export function buildDescriptionPrompt(input: DescriptionPromptInput): string {
  const { company, area, areaFolder, repositories, knowledgeDir, companyInstructions, title, description, instructions } = input;
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
    ...(instructions.trim() ? ['', '## How to write the new description', instructions.trim()] : []),
    ...(companyInstructions.trim() ? ['', '## Client instructions', 'Follow any task format they define.', companyInstructions.trim()] : []),
    '',
    '## Answer',
    'Answer with only this JSON and nothing else: {"description": "<the new description in Markdown>"}',
  ].join('\n');
}
