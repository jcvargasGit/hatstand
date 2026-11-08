import { existsSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { Company, PlanningPlace, Task } from '../shared/schemas';
import { findGitRoot } from './paths';

const PLACE_RULES: { name: string; folders: string[] }[] = [
  { name: 'Tickets', folders: ['backlog', 'tickets', 'issues', 'stories'] },
  { name: 'Decisions', folders: ['adr', 'adrs', 'decisions'] },
  { name: 'Specs', folders: ['specs', 'spec', 'rfc', 'rfcs'] },
  { name: 'Reviews', folders: ['code-reviews', 'reviews'] },
];

export const isInside = (path: string, root: string) => path === root || path.startsWith(`${root}${sep}`);

export function suggestPlanningPlaces(folders: string[]): PlanningPlace[] {
  const shortestFirst = [...folders].sort((a, b) => a.length - b.length);
  return PLACE_RULES.flatMap(({ name, folders: wanted }) => {
    for (const ending of wanted) {
      const folder = shortestFirst.find((path) => {
        const lower = path.toLowerCase();
        return lower === ending || lower.endsWith(`/${ending}`);
      });
      if (folder) return [{ name, folder }];
    }
    return [];
  });
}

export function withPlanningRepo(company: Company, path: string, places: PlanningPlace[]): Company {
  return { ...company, projects: company.projects.filter((project) => resolve(project.path) !== path), planning: { path, places } };
}

export function protectedFolderConflict(company: Company, path: string, dataHome: string): string | null {
  if (isInside(path, resolve(dataHome))) return 'Choose a folder outside Hatstand\'s own data folder.';
  const { knowledgeDir, pluginDir } = company.context;
  const overlaps = [knowledgeDir, pluginDir].some((dir) => dir !== undefined && (isInside(path, resolve(dir)) || isInside(resolve(dir), path)));
  return overlaps ? 'This folder overlaps this client\'s knowledge or LLM config, which must stay out of git. Change that folder first.' : null;
}

export function planningConflict(company: Company, rawPath: string, dataHome: string, tasks: Task[] = []): string | null {
  const path = resolve(rawPath);
  if (!existsSync(path) || !statSync(path).isDirectory()) return `The folder ${path} does not exist.`;
  const conflict = protectedFolderConflict(company, path, dataHome);
  if (conflict) return conflict;
  const repo = company.projects.find((project) => resolve(project.path) === path);
  const taskWithCopy = repo && tasks.find((task) => task.worktrees.some((worktree) => worktree.projectId === repo.id));
  if (taskWithCopy) return `The task "${taskWithCopy.title}" has a copy of this repository. Remove that copy first.`;
  return findGitRoot(path) ? null : `${path} is not a git repository. Choose a repository, or create a planning repository instead.`;
}
