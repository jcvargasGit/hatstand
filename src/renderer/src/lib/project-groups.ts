import type { Company, Project } from '../../../shared/schemas';

export const SEVERAL_AREAS = 'several-areas';
export const NO_AREA = 'no-area';

export type ProjectGroup = {
  id: string;
  title: string;
  projects: Project[];
};

/**
 * The repositories of a client by the area that owns them: the areas in their order, then the repositories
 * split by folder between several areas, then the ones with no area. A group with nothing to show is left out.
 */
export function groupProjectsByArea(company: Company, filter = ''): ProjectGroup[] {
  const term = filter.trim().toLowerCase();
  const areaIds = new Set(company.subdomains.map((subdomain) => subdomain.id));
  const groupOf = (project: Project) => {
    if (project.splitByFolder) return SEVERAL_AREAS;
    return project.subdomainId && areaIds.has(project.subdomainId) ? project.subdomainId : NO_AREA;
  };
  const shown = company.projects.filter((project) => project.name.toLowerCase().includes(term));
  const groups: Omit<ProjectGroup, 'projects'>[] = [
    ...company.subdomains.map((subdomain) => ({ id: subdomain.id, title: subdomain.name })),
    { id: SEVERAL_AREAS, title: 'Several areas' },
    { id: NO_AREA, title: 'No area' },
  ];
  return groups
    .map((group) => ({ ...group, projects: shown.filter((project) => groupOf(project) === group.id) }))
    .filter((group) => group.projects.length > 0);
}
