import { describe, expect, it } from 'vitest';
import { applySuggestions, suggestSubdomains } from '../../src/renderer/src/lib/subdomain-suggestions';
import type { Company } from '../../src/shared/schemas';

const company = (names: string[], subdomains: Company['subdomains'] = []): Company => ({
  id: 'acme',
  name: 'Acme',
  color: '#E8A33D',
  origin: 'existing', hasCode: true, confirmedSteps: [],
  skipPermissions: false,
  protectedPaths: [], links: [],
  subdomains,
  projects: names.map((name, index) => ({ id: String(index), name, path: `/${name}` })),
  context: {},
});

const summary = (input: Company) =>
  Object.fromEntries(suggestSubdomains(input).suggestions.map((item) => [item.name, item.projectNames]));

describe('suggestSubdomains', () => {
  it('matches existing subdomains, ignoring plurals and case', () => {
    const input = company(['shop-order-api', 'web/ORDERS'], [{ id: 'p', name: 'Orders', description: '', folders: [], links: [] }]);
    expect(summary(input)).toEqual({ Orders: ['shop-order-api', 'web/ORDERS'] });
  });

  it('prefers the most specific subdomain, including one written as a single word', () => {
    const input = company(['weatherstation-api'], [
      { id: 'p', name: 'Stations', description: '', folders: [], links: [] },
      { id: 'ws', name: 'Weather stations', description: '', folders: [], links: [] },
    ]);
    expect(suggestSubdomains(input).suggestions[0]?.subdomainId).toBe('ws');
  });

  it('proposes a new subdomain from a word that repositories share, skipping generic words', () => {
    const input = company(['app-rain-maps-api', 'app-rain-alerts-api', 'web-portal']);
    const { suggestions, unmatched } = suggestSubdomains(input);
    expect(suggestions.map((item) => [item.name, item.projectNames.length])).toEqual([['Rain', 2]]);
    expect(unmatched).toBe(1);
  });

  it('ignores a word in most repositories, such as the company prefix', () => {
    const names = ['zen-gallery-a', 'zen-gallery-b', 'zen-media-a', 'zen-media-b', 'zen-other'];
    expect(Object.keys(summary(company(names)))).toEqual(['Gallery', 'Media']);
  });

  it('does not propose a new subdomain for a single repository', () => {
    const { suggestions, unmatched } = suggestSubdomains(company(['media-reports-a', 'media-reports-b', 'reports-export', 'audit-tool']));
    expect(suggestions.map((item) => [item.name, item.projectNames.length])).toEqual([['Media', 2]]);
    expect(unmatched).toBe(2);
  });

  it('leaves assigned repositories alone', () => {
    const input = company(['rain-a', 'rain-b']);
    const assigned = { ...input, projects: input.projects.map((project) => ({ ...project, subdomainId: 'x' })) };
    expect(suggestSubdomains(assigned).suggestions).toEqual([]);
  });
});

describe('applySuggestions', () => {
  it('creates new subdomains, reuses one with the same name, and returns a new company', () => {
    const input = company(['rain-a', 'rain-b'], [{ id: 'l', name: 'rain', description: '', folders: [], links: [] }]);
    const { suggestions } = suggestSubdomains({ ...input, subdomains: [] });
    const next = applySuggestions(input, suggestions, () => 'new-id');
    expect(next.subdomains).toEqual([{ id: 'l', name: 'rain', description: '', folders: [], links: [] }]);
    expect(next.projects.map((project) => project.subdomainId)).toEqual(['l', 'l']);
    expect(input.projects[0]?.subdomainId).toBeUndefined();

    const created = applySuggestions({ ...input, subdomains: [] }, suggestions, () => 'new-id');
    expect(created.subdomains).toEqual([{ id: 'new-id', name: 'Rain', description: '', folders: [], links: [] }]);
  });
});
