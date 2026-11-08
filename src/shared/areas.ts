import type { Company, Subdomain } from './schemas';
import { slugify } from './slug';

export const CORE_AREA_NAME = 'Core';
const CORE_FOLDER = 'core';

export const areaFolder = (area: Pick<Subdomain, 'id' | 'folder'>): string => area.folder ?? area.id;

export const areaFolderSlug = (name: string): string => slugify(name, 'area');

export const defaultArea = (company: Pick<Company, 'subdomains' | 'defaultAreaId'>): Subdomain | undefined =>
  company.subdomains.find((area) => area.id === company.defaultAreaId);

export const shownAreaName = (company: Pick<Company, 'subdomains' | 'defaultAreaId'>, areaId: string | undefined): string | undefined =>
  areaId === company.defaultAreaId ? undefined : company.subdomains.find((area) => area.id === areaId)?.name;

export const isDefaultArea = (company: Pick<Company, 'defaultAreaId'>, areaId: string): boolean => company.defaultAreaId === areaId;

export function withCoreArea(company: Company, newId: () => string): Company {
  if (defaultArea(company)) return company;
  const existing = company.subdomains.find((area) => area.folder === CORE_FOLDER) ?? company.subdomains.find((area) => areaFolderSlug(area.name) === CORE_FOLDER);
  if (existing) return { ...company, defaultAreaId: existing.id };
  const core: Subdomain = { id: newId(), name: CORE_AREA_NAME, description: 'Tasks that belong to no other area.', folders: [], links: [] };
  return { ...company, defaultAreaId: core.id, subdomains: [core, ...company.subdomains] };
}

export type AreaFolderMove = { from: string; to: string };

export function placeAreaFolders(areas: Subdomain[], exists: (folder: string) => boolean): { areas: Subdomain[]; moves: AreaFolderMove[] } {
  const taken = new Set(areas.flatMap((area) => (area.folder ? [area.folder] : [])));
  const legacy = new Set(areas.filter((area) => !area.folder && exists(area.id)).map((area) => area.id));
  const moves: AreaFolderMove[] = [];
  const placed = areas.map((area) => {
    if (area.folder) return area;
    const hasLegacy = legacy.has(area.id);
    const blocked = (folder: string) => taken.has(folder) || (folder !== area.id && (legacy.has(folder) || (hasLegacy && exists(folder))));
    const base = areaFolderSlug(area.name);
    let folder = base;
    for (let suffix = 2; blocked(folder); suffix += 1) folder = `${base}-${suffix}`;
    taken.add(folder);
    if (hasLegacy && folder !== area.id) moves.push({ from: area.id, to: folder });
    return { ...area, folder };
  });
  return { areas: placed, moves };
}
