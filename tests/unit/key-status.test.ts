import { describe, expect, it } from 'vitest';
import { hasKeyProblem, keyProblemAdvice, keyState, keyStateLabel } from '../../src/shared/key-status';
import { canCheckKey, renewalUrl, serviceTokenName } from '../../src/shared/known-keys';
import type { KeyCheck } from '../../src/shared/schemas';

const NOW = new Date('2026-11-18T12:00:00Z');
const checked = (check?: Partial<KeyCheck>) => ({ name: 'GITHUB_TOKEN', check: check ? { at: NOW.toISOString(), result: 'valid' as const, ...check } : undefined });

describe('the state of a key', () => {
  it.each([
    ['unchecked', undefined, ''],
    ['valid', {}, 'Valid'],
    ['valid', { expiresAt: '2027-03-03T12:00:00Z' }, 'Valid until Mar 3, 2027'],
    ['expires-soon', { expiresAt: '2026-11-23T13:00:00Z' }, 'Expires in 5 days'],
    ['expires-soon', { expiresAt: '2026-11-19T13:00:00Z' }, 'Expires tomorrow'],
    ['expires-soon', { expiresAt: '2026-11-18T18:00:00Z' }, 'Expires today'],
    ['expired', { expiresAt: '2026-11-10T12:00:00Z' }, 'Expired on Nov 10, 2026'],
    ['rejected', { result: 'rejected' as const }, 'Rejected'],
    ['rejected', { result: 'rejected' as const, expiresAt: '2027-03-03T12:00:00Z' }, 'Rejected'],
    ['valid', { expiresAt: 'not a date' }, 'Valid'],
  ])('is %s for %j', (state, check, label) => {
    expect(keyState(checked(check), NOW)).toBe(state);
    expect(keyStateLabel(checked(check), NOW)).toBe(label);
  });

  it('calls a key soon to expire only within 14 days', () => {
    expect(keyState(checked({ expiresAt: '2026-12-02T11:00:00Z' }), NOW)).toBe('expires-soon');
    expect(keyState(checked({ expiresAt: '2026-12-02T13:00:00Z' }), NOW)).toBe('valid');
  });

  it('counts rejected, expired and soon to expire as problems', () => {
    expect(hasKeyProblem(checked(), NOW)).toBe(false);
    expect(hasKeyProblem(checked({}), NOW)).toBe(false);
    expect(hasKeyProblem(checked({ result: 'rejected' }), NOW)).toBe(true);
    expect(hasKeyProblem(checked({ expiresAt: '2026-11-10T12:00:00Z' }), NOW)).toBe(true);
    expect(hasKeyProblem(checked({ expiresAt: '2026-11-20T12:00:00Z' }), NOW)).toBe(true);
  });

  it('says what to do about a problem, and nothing when there is none', () => {
    expect(keyProblemAdvice(checked({}), NOW)).toBe('');
    expect(keyProblemAdvice(checked({ result: 'rejected' }), NOW)).toBe('GitHub rejected it. Create a new token and replace this one.');
    expect(keyProblemAdvice({ name: 'JIRA_API_TOKEN', check: { at: '', result: 'rejected' } }, NOW)).toMatch(/Check JIRA_SITE and JIRA_EMAIL/);
    expect(keyProblemAdvice(checked({ expiresAt: '2026-11-20T12:00:00Z' }), NOW)).toMatch(/before it stops working/);
  });
});

describe('the keys Hatstand knows', () => {
  it('can check a token once it is saved with the keys it needs', () => {
    expect(canCheckKey('GITHUB_TOKEN', ['GITHUB_TOKEN'])).toBe(true);
    expect(canCheckKey('GITHUB_TOKEN', [])).toBe(false);
    expect(canCheckKey('JIRA_API_TOKEN', ['JIRA_API_TOKEN', 'JIRA_SITE'])).toBe(false);
    expect(canCheckKey('JIRA_API_TOKEN', ['JIRA_API_TOKEN', 'JIRA_SITE', 'JIRA_EMAIL'])).toBe(true);
    expect(canCheckKey('JIRA_SITE', ['JIRA_SITE'])).toBe(false);
    expect(canCheckKey('ACME_API_TOKEN', ['ACME_API_TOKEN'])).toBe(false);
  });

  it('names the token a service signs in with, as the rest of Hatstand picks it', () => {
    expect(serviceTokenName('github', ['GITHUB_TOKEN', 'GH_TOKEN'])).toBe('GITHUB_TOKEN');
    expect(serviceTokenName('github', ['GH_TOKEN'])).toBe('GH_TOKEN');
    expect(serviceTokenName('github', [])).toBe('GITHUB_TOKEN');
    expect(serviceTokenName('gitlab', [])).toBe('GITLAB_TOKEN');
    expect(serviceTokenName('jira', [])).toBe('JIRA_API_TOKEN');
  });

  it('links to where a new token is created, on the GitLab of the client', () => {
    expect(renewalUrl('jira', undefined)).toContain('id.atlassian.com');
    expect(renewalUrl('github', undefined)).toContain('https://github.com/settings/tokens');
    expect(renewalUrl('gitlab', { provider: 'gitlab', host: 'git.acme.dev' })).toContain('https://git.acme.dev/-/user_settings/personal_access_tokens');
    expect(renewalUrl('gitlab', { provider: 'github' })).toContain('https://gitlab.com/');
    expect(renewalUrl('gitlab', { provider: 'gitlab', host: 'http://git.acme.dev' })).toBeNull();
  });
});
