import type { Company } from '../../../shared/schemas';

export type SubdomainSuggestion = {
  key: string;
  name: string;
  subdomainId?: string;
  projectIds: string[];
  projectNames: string[];
};

const GENERIC_WORDS = new Set(
  `api app back backend front frontend web ui service svc server client core lib common shared infra infrastructure
   deploy test doc main repo sdk tool util lambda worker ms microservice go node java python grpc rest old new legacy poc`.split(/\s+/),
);
const MAX_SHARE_OF_REPOS = 0.6;
const MIN_REPOS_FOR_SHARE_LIMIT = 5;

const stem = (word: string) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);

const words = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !/^\d+$/.test(word));

const titleCase = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

function matchSubdomain(repoWords: string[], subdomains: Company['subdomains']) {
  const stems = new Set(repoWords.map(stem));
  const candidates = subdomains
    .map((subdomain) => ({ subdomain, parts: words(subdomain.name).map(stem) }))
    .filter(({ parts }) => parts.length > 0)
    .sort((a, b) => b.parts.join('').length - a.parts.join('').length);
  const match = candidates.find(({ parts }) => parts.every((part) => stems.has(part)) || stems.has(parts.join('')));
  return match?.subdomain;
}

export function suggestSubdomains(company: Company): { suggestions: SubdomainSuggestion[]; unmatched: number } {
  const open = company.projects.filter((project) => !project.subdomainId && !project.splitByFolder);
  const groups = new Map<string, SubdomainSuggestion>();
  const addTo = (key: string, name: string, subdomainId: string | undefined, project: Company['projects'][number]) => {
    const group = groups.get(key) ?? { key, name, subdomainId, projectIds: [], projectNames: [] };
    groups.set(key, {
      ...group,
      projectIds: [...group.projectIds, project.id],
      projectNames: [...group.projectNames, project.name],
    });
  };

  const parsed = open.map((project) => ({ project, repoWords: words(project.name) }));
  const unassigned = parsed.filter(({ project, repoWords }) => {
    const subdomain = matchSubdomain(repoWords, company.subdomains);
    if (subdomain) addTo(subdomain.id, subdomain.name, subdomain.id, project);
    return !subdomain;
  });

  const repoCount = new Map<string, number>();
  for (const { repoWords } of unassigned) {
    for (const word of new Set(repoWords.map(stem))) repoCount.set(word, (repoCount.get(word) ?? 0) + 1);
  }
  const tooCommon = (count: number) =>
    company.projects.length >= MIN_REPOS_FOR_SHARE_LIMIT && count > company.projects.length * MAX_SHARE_OF_REPOS;
  const usable = (word: string) => {
    const count = repoCount.get(stem(word)) ?? 0;
    return !GENERIC_WORDS.has(stem(word)) && count >= 2 && !tooCommon(count);
  };

  let unmatched = 0;
  for (const { project, repoWords } of unassigned) {
    const word = repoWords.find(usable);
    if (word) addTo(`new:${stem(word)}`, titleCase(word), undefined, project);
    else unmatched += 1;
  }
  const all = [...groups.values()];
  const suggestions = all.filter((group) => group.subdomainId || group.projectIds.length >= 2);
  const lonely = all.length - suggestions.length;
  return { suggestions, unmatched: unmatched + lonely };
}

export function applySuggestions(company: Company, suggestions: SubdomainSuggestion[], newId: () => string): Company {
  const subdomains = [...company.subdomains];
  const assigned = new Map<string, string>();
  for (const suggestion of suggestions) {
    const name = suggestion.name.trim();
    const existing = suggestion.subdomainId
      ? subdomains.find((item) => item.id === suggestion.subdomainId)
      : subdomains.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const subdomain = existing ?? { id: newId(), name, description: '', folders: [], links: [] };
    if (!existing) subdomains.push(subdomain);
    for (const projectId of suggestion.projectIds) assigned.set(projectId, subdomain.id);
  }
  return {
    ...company,
    subdomains,
    projects: company.projects.map((project) => {
      const subdomainId = assigned.get(project.id);
      return subdomainId && !project.subdomainId ? { ...project, subdomainId } : project;
    }),
  };
}
