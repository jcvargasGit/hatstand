import { existsSync } from 'node:fs';
import { activeKnowledgeDir } from './active-folders';
import { homedir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import type { Company, Subdomain, Project, Task, TaskWorktree } from '../shared/schemas';
import type { DataPaths } from './paths';
import { workRepositories } from '../shared/work-repos';
import { areaFolder } from '../shared/areas';

const subdomainFolders = (company: Company, task: Task) => company.subdomains.find((item) => item.id === task.subdomainId)?.folders ?? [];

export function taskRepositories(company: Company, task: Task): Project[] {
  const folders = subdomainFolders(company, task);
  return workRepositories(company).filter((project) => task.projectIds.includes(project.id) || folders.some((folder) => folder.projectId === project.id));
}

export function taskFolderPaths(company: Company, task: Task): string[] {
  return subdomainFolders(company, task).flatMap((folder) => {
    const project = company.projects.find((item) => item.id === folder.projectId);
    return project ? [join(project.path, folder.path)] : [];
  });
}

export function taskFocus(company: Company, task: Task): string[] {
  const folders = subdomainFolders(company, task);
  const wholeRepos = taskRepositories(company, task).filter((project) => !folders.some((folder) => folder.projectId === project.id));
  const folderNames = folders.flatMap((folder) => {
    const project = company.projects.find((item) => item.id === folder.projectId);
    return project ? [`${project.name}/${folder.path}`] : [];
  });
  return [...wholeRepos.map((project) => project.name), ...folderNames];
}

export function activeWorktrees(company: Company, task: Task): TaskWorktree[] {
  if (!task.isolated) return [];
  const repositories = taskRepositories(company, task);
  return task.worktrees.filter((worktree) => repositories.some((repo) => repo.id === worktree.projectId));
}

export function companyWithCode(company: Company, task: Task): Company {
  const worktrees = activeWorktrees(company, task);
  return {
    ...company,
    projects: company.projects.map((project) => {
      const worktree = worktrees.find((item) => item.projectId === project.id);
      return worktree ? { ...project, path: worktree.path } : project;
    }),
  };
}

export function sessionFolder(worktrees: TaskWorktree[]): string | null {
  const [first] = worktrees;
  if (!first) return null;
  return worktrees.length === 1 ? first.path : dirname(first.path);
}

export function reposOutside(cwd: string, repositories: Pick<Project, 'path'>[]): string[] {
  return repositories.map((repo) => repo.path).filter((path) => path !== cwd && !path.startsWith(`${cwd}${sep}`));
}

export const taskArea = (company: Company, task: Task): Subdomain | undefined => company.subdomains.find((area) => area.id === task.subdomainId);

export const worksOnlyInAreaFolder = (company: Company, task: Task): boolean => taskArea(company, task) !== undefined && workRepositories(company).length === 0;

export function workingDirFor(paths: DataPaths, company: Company, task: Task): string {
  const area = taskArea(company, task);
  if (area && worksOnlyInAreaFolder(company, task)) return paths.areaDir(company.id, areaFolder(area));
  return resolveWorkingDir(company, task, company.subdomains.length > 0 ? activeKnowledgeDir(paths, company) : undefined);
}

export function resolveWorkingDir(company: Company, task: Task, privateFolder?: string): string {
  const cwd = company.rootDir ?? taskRepositories(company, task)[0]?.path ?? workRepositories(company)[0]?.path ?? company.projects[0]?.path ?? privateFolder;
  if (!cwd) {
    throw new Error(`Add a client folder, a repository or an area to ${company.name} before starting a session.`);
  }
  if (!existsSync(cwd)) throw new Error(`The folder ${cwd} does not exist.`);
  return cwd;
}

function commonFolder(paths: string[]): string {
  const [first = [], ...rest] = paths.map((path) => path.split(sep));
  let length = first.length;
  for (const parts of rest) {
    let same = 0;
    while (same < length && parts[same] === first[same]) same += 1;
    length = same;
  }
  return first.slice(0, length).join(sep);
}

export function defaultClientFolder(company: Pick<Company, 'id' | 'projects'>, home = homedir()): string {
  const shared = commonFolder(company.projects.map((project) => project.path));
  const tooBroad = shared === '' || home === shared || home.startsWith(`${shared}${sep}`);
  return tooBroad ? join(home, 'projects', company.id) : shared;
}
