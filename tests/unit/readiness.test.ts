import { describe, expect, it } from 'vitest';
import { clientReadiness, type ReadinessInput } from '../../src/shared/readiness';
import type { Company } from '../../src/shared/schemas';

const empty: Company = {
  id: 'acme',
  name: 'Acme',
  color: '#112233',
  skipPermissions: false,
  origin: 'existing', hasCode: true, confirmedSteps: [],
  protectedPaths: [], links: [],
  subdomains: [],
  projects: [],
  context: {},
};
const project = { id: 'api', name: 'api', path: '/repos/api' };
const input = (company: Partial<Company> = {}, rest: Partial<ReadinessInput> = {}): ReadinessInput => ({
  company: { ...empty, ...company },
  secretNames: [],
  hasLocalKnowledge: false,
  hasLocalPlugin: false,
  hasStarterInstructions: false,
  ...rest,
});
const done = (value: ReadinessInput, id: string) => clientReadiness(value).items.find((item) => item.id === id)?.done;

describe('clientReadiness', () => {
  it('counts knowledge as done once its folder is accepted', () => {
    const { items } = clientReadiness(input({ confirmedSteps: ['knowledge'] }));
    expect(items.find((item) => item.id === 'knowledge')?.done).toBe(true);
  });

  it('does not ask a client without code for a repository', () => {
    const { items } = clientReadiness({ company: { ...empty, hasCode: false }, secretNames: [], hasLocalKnowledge: false, hasLocalPlugin: false, hasStarterInstructions: false });
    expect(items.find((item) => item.id === 'workspace')?.label).toBe('Add an area or a client folder');
  });

  it('starts at zero and blocks sessions', () => {
    const readiness = clientReadiness(input());
    expect(readiness.percent).toBe(0);
    expect(readiness.canStart).toBe(false);
  });

  it('allows sessions with only a repository or only a client folder', () => {
    expect(clientReadiness(input({ projects: [project] })).canStart).toBe(true);
    const withFolder = clientReadiness(input({ rootDir: '/work' }));
    expect(withFolder.canStart).toBe(true);
    expect(withFolder.percent).toBe(25);
  });

  it('reaches 100 without optional steps', () => {
    const readiness = clientReadiness(
      input(
        { projects: [project], protectedPaths: ['/repos/api'], gitIdentity: { name: 'A', email: 'a@e.dev', folder: '/repos/', appliedAt: 'x' }, context: { knowledgeDir: '/kb', pluginDir: '/plugin' } },
        { secretNames: ['GITHUB_TOKEN'] },
      ),
    );
    expect(readiness.percent).toBe(100);
    expect(readiness.items.filter((item) => !item.done).map((item) => item.level)).toEqual([
      'optional',
      'optional',
      'optional',
    ]);
  });

  it('does not change the percent for optional steps', () => {
    const readiness = clientReadiness(
      input({
        links: [{ id: 'l', label: 'Chat', url: 'https://a.co' }],
        photo: { sourceUrl: 'https://a.co/x.png', type: 'image/png', savedAt: 'now' },
      }),
    );
    expect(readiness.percent).toBe(0);
  });

  it('counts knowledge from a custom folder or the default one, but not from instructions', () => {
    expect(done(input(), 'knowledge')).toBe(false);
    expect(done(input({ context: { instructionsFile: '/a.md' } }), 'knowledge')).toBe(false);
    expect(done(input({ context: { knowledgeDir: '/kb' } }), 'knowledge')).toBe(true);
    expect(done(input({}, { hasLocalKnowledge: true }), 'knowledge')).toBe(true);
  });

  it('counts the LLM config from instructions, a plugin or the accepted step', () => {
    expect(done(input(), 'llm-config')).toBe(false);
    expect(done(input({ context: { instructionsFile: '/a.md' } }), 'llm-config')).toBe(true);
    expect(done(input({ context: { instructionsFile: '/a.md' } }, { hasStarterInstructions: true }), 'llm-config')).toBe(false);
    expect(done(input({ context: { pluginDir: '/plugin' } }), 'llm-config')).toBe(true);
    expect(done(input({}, { hasLocalPlugin: true }), 'llm-config')).toBe(true);
    expect(done(input({ confirmedSteps: ['llm-config'] }), 'llm-config')).toBe(true);
  });

  it.each([
    [['GITHUB_TOKEN'], true],
    [['GH_TOKEN'], true],
    [['GITLAB_TOKEN'], true],
    [['JIRA_SITE', 'JIRA_EMAIL', 'JIRA_API_TOKEN'], true],
    [['JIRA_SITE', 'JIRA_EMAIL'], false],
    [['GITHUB_TOKEN_OTHER', 'AWS_KEY'], false],
  ])('treats keys %j as a connected tracker: %s', (secretNames, expected) => {
    expect(done(input({}, { secretNames }), 'tracker')).toBe(expected);
  });

  it('requires protection on every current repository, and not when there are none', () => {
    const second = { id: 'web', name: 'web', path: '/repos/web' };
    expect(done(input(), 'protection')).toBeUndefined();
    expect(done(input({ projects: [project, second], protectedPaths: ['/repos/api'] }), 'protection')).toBe(false);
    expect(done(input({ projects: [project, second], protectedPaths: ['/repos/api', '/repos/web'] }), 'protection')).toBe(true);
  });
});

describe('a key that stopped working', () => {
  const now = new Date('2026-11-18T12:00:00Z');
  const check = (rest: object = {}) => ({ at: now.toISOString(), result: 'valid' as const, ...rest });
  const healthOf = (keys: ReadinessInput['keys']) => {
    const readiness = clientReadiness(input({}, { secretNames: (keys ?? []).map((key) => key.name), keys, now }));
    return { item: readiness.items.find((entry) => entry.id === 'key-health'), percent: readiness.percent };
  };

  it('adds nothing while every key is fine, so the percent stays', () => {
    const fine = healthOf([{ name: 'GITHUB_TOKEN', check: check({ expiresAt: '2027-03-03T12:00:00Z' }) }, { name: 'ACME_API_TOKEN' }]);
    expect(fine.item).toBeUndefined();
    expect(fine.percent).toBe(clientReadiness(input({}, { secretNames: ['GITHUB_TOKEN'] })).percent);
  });

  it.each([
    [{ result: 'rejected' as const }, 'Rejected. GitHub rejected it. Create a new token and replace this one.'],
    [{ expiresAt: '2026-11-10T12:00:00Z' }, 'Expired on Nov 10, 2026. Create a new token and replace this one.'],
    [{ expiresAt: '2026-11-23T13:00:00Z' }, 'Expires in 5 days. Create a new token and replace this one before it stops working.'],
  ])('asks to replace a key that is %j', (state, hint) => {
    const { item, percent } = healthOf([{ name: 'GITHUB_TOKEN', check: check(state) }]);
    expect(item).toMatchObject({ label: 'Replace GITHUB_TOKEN', hint, done: false, level: 'recommended', section: 'section-keys' });
    expect(percent).toBeLessThan(clientReadiness(input({}, { secretNames: ['GITHUB_TOKEN'] })).percent);
  });

  it('names the other keys with a problem in the same item', () => {
    const { item } = healthOf([
      { name: 'GITHUB_TOKEN', check: check({ result: 'rejected' }) },
      { name: 'GITLAB_TOKEN', check: check({ expiresAt: '2026-11-10T12:00:00Z' }) },
    ]);
    expect(item?.hint).toMatch(/Also: GITLAB_TOKEN\.$/);
  });
});
