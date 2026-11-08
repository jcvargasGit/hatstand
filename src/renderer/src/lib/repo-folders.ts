import type { Company, Subdomain } from '../../../shared/schemas';

const withoutRepoFolder = (subdomain: Subdomain, projectId: string, path?: string): Subdomain => ({
  ...subdomain,
  folders: subdomain.folders.filter((folder) => folder.projectId !== projectId || (path !== undefined && folder.path !== path)),
});

export function splitRepo(company: Company, projectId: string): Company {
  return {
    ...company,
    projects: company.projects.map((project) => (project.id === projectId ? { ...project, subdomainId: undefined, splitByFolder: true } : project)),
  };
}

export function assignWholeRepo(company: Company, projectId: string, subdomainId: string | undefined): Company {
  return {
    ...company,
    subdomains: company.subdomains.map((subdomain) => withoutRepoFolder(subdomain, projectId)),
    projects: company.projects.map((project) => (project.id === projectId ? { ...project, subdomainId, splitByFolder: undefined } : project)),
  };
}

export function removeRepo(company: Company, projectId: string): Company {
  return {
    ...company,
    subdomains: company.subdomains.map((subdomain) => withoutRepoFolder(subdomain, projectId)),
    projects: company.projects.filter((project) => project.id !== projectId),
  };
}

export function folderOwner(company: Company, projectId: string, path: string): string {
  return company.subdomains.find((subdomain) => subdomain.folders.some((folder) => folder.projectId === projectId && folder.path === path))?.id ?? '';
}

export function assignFolder(company: Company, projectId: string, path: string, subdomainId: string): Company {
  return {
    ...company,
    subdomains: company.subdomains.map((subdomain) => {
      const rest = withoutRepoFolder(subdomain, projectId, path);
      return subdomain.id === subdomainId ? { ...rest, folders: [...rest.folders, { projectId, path }] } : rest;
    }),
  };
}

export function assignFolderToNewSubdomain(company: Company, projectId: string, path: string, subdomain: Pick<Subdomain, 'id' | 'name'>): Company {
  return assignFolder({ ...company, subdomains: [...company.subdomains, { ...subdomain, description: '', folders: [], links: [] }] }, projectId, path, subdomain.id);
}

export const folderName = (path: string) => path.split('/').at(-1) ?? path;
