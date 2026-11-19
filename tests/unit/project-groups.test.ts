import { describe, expect, it } from 'vitest';
import { groupProjectsByArea } from '../../src/renderer/src/lib/project-groups';
import type { Company } from '../../src/shared/schemas';

const company: Company = {
  id: 'acme',
  name: 'Acme',
  color: '#E8A33D',
  origin: 'existing',
  hasCode: true,
  confirmedSteps: [],
  skipPermissions: false,
  protectedPaths: [],
  links: [],
  subdomains: [
    { id: 'uploads', name: 'Uploads', description: '', links: [], folders: [] },
    { id: 'search', name: 'Search', description: '', links: [], folders: [] },
    { id: 'billing', name: 'Billing', description: '', links: [], folders: [] },
  ],
  projects: [
    { id: 'tools', name: 'tools', path: '/tools' },
    { id: 'search-api', name: 'search-api', path: '/search-api', subdomainId: 'search' },
    { id: 'mono', name: 'mono', path: '/mono', splitByFolder: true },
    { id: 'uploads-web', name: 'Uploads-Web', path: '/uploads-web', subdomainId: 'uploads' },
    { id: 'uploads-api', name: 'uploads-api', path: '/uploads-api', subdomainId: 'uploads' },
    { id: 'orphan', name: 'orphan', path: '/orphan', subdomainId: 'gone' },
  ],
  context: {},
};

const shape = (filter?: string) => groupProjectsByArea(company, filter).map((group) => [group.title, group.projects.map((project) => project.id)]);

describe('the repositories of a client, by area', () => {
  it('follows the order of the areas, then the split ones, then the ones with no area', () => {
    expect(shape()).toEqual([
      ['Uploads', ['uploads-web', 'uploads-api']],
      ['Search', ['search-api']],
      ['Several areas', ['mono']],
      ['No area', ['tools', 'orphan']],
    ]);
  });

  it('leaves out an area with no repository', () => {
    expect(shape().some(([title]) => title === 'Billing')).toBe(false);
  });

  it('keeps a split repository out of the area it had before', () => {
    const split = { ...company, projects: [{ id: 'mono', name: 'mono', path: '/mono', splitByFolder: true, subdomainId: 'uploads' }] };
    expect(groupProjectsByArea(split).map((group) => group.id)).toEqual(['several-areas']);
  });

  it('filters by name, whatever the case, and drops the groups left empty', () => {
    expect(shape(' UPLOADS ')).toEqual([['Uploads', ['uploads-web', 'uploads-api']]]);
    expect(shape('api')).toEqual([
      ['Uploads', ['uploads-api']],
      ['Search', ['search-api']],
    ]);
    expect(shape('nothing-like-this')).toEqual([]);
  });

  it('has no groups for a client with no repositories', () => {
    expect(groupProjectsByArea({ ...company, projects: [] })).toEqual([]);
  });
});
