import type { Company, Project } from './schemas';

const clean = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '');

function isWithin(path: string, folder: string): boolean {
  const [inner, outer] = [clean(path), clean(folder)];
  return inner === outer || inner.startsWith(`${outer}/`);
}

export function isControlRepo(company: Company, repo: Pick<Project, 'path'>): boolean {
  const planning = company.planning?.path;
  if (planning && (isWithin(planning, repo.path) || isWithin(repo.path, planning))) return true;
  return [company.context.knowledgeDir, company.context.pluginDir].some((folder) => folder !== undefined && isWithin(repo.path, folder));
}

export const workRepositories = (company: Company): Project[] => company.projects.filter((repo) => !isControlRepo(company, repo));

export function repoToCopy(company: Company, name: string): Project {
  const repo = company.projects.find((item) => item.name === name);
  if (!repo) {
    throw new Error(`This client has no repository called "${name}". Its repositories are: ${workRepositories(company).map((item) => item.name).join(', ')}.`);
  }
  if (isControlRepo(company, repo)) {
    throw new Error(`${name} holds this client's planning and context. It does not get a copy, and it does not count as a repository this task changes.`);
  }
  return repo;
}

export function areaRepositoryIds(company: Company, areaId: string): string[] {
  const folders = company.subdomains.find((area) => area.id === areaId)?.folders ?? [];
  return workRepositories(company)
    .filter((repo) => repo.subdomainId === areaId || folders.some((folder) => folder.projectId === repo.id))
    .map((repo) => repo.id);
}

export function suggestedRepositoryIds(company: Company, areaId = ''): string[] {
  const inArea = areaRepositoryIds(company, areaId);
  if (inArea.length > 0) return inArea;
  const repos = workRepositories(company);
  return repos.length === 1 ? repos.map((repo) => repo.id) : [];
}
