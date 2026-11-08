import { describe, expect, it } from 'vitest';
import { buildAgentEnv, isSensitiveSecret, parseEnvFile } from '../../src/main/env';

describe('buildAgentEnv', () => {
  const env = buildAgentEnv({
    base: { HOME: '/home/dev', OTHER_CLIENT_TOKEN: 'leak', AWS_PROFILE: 'other-client' },
    path: '/bin',
    secrets: { JIRA_API_TOKEN: 'mine' },
    extra: { HATSTAND_STATUS_FILE: '/run/status' },
  });

  it('keeps the basics and adds only this client keys', () => {
    expect(env.HOME).toBe('/home/dev');
    expect(env.PATH).toBe('/bin');
    expect(env.JIRA_API_TOKEN).toBe('mine');
    expect(env.HATSTAND_STATUS_FILE).toBe('/run/status');
  });

  it('does not inherit anything else from the app environment', () => {
    expect(env.OTHER_CLIENT_TOKEN).toBeUndefined();
    expect(env.AWS_PROFILE).toBeUndefined();
  });
});

describe('parseEnvFile', () => {
  it('reads plain, exported and quoted values, and skips comments', () => {
    const parsed = parseEnvFile(
      ['# comment', 'A=1', 'export B=two', 'C="three # four"', "D='five'", 'E=six # note', '', 'not a line'].join('\n'),
    );
    expect(parsed).toEqual({ A: '1', B: 'two', C: 'three # four', D: 'five', E: 'six' });
  });
});

describe('isSensitiveSecret', () => {
  it('flags credential names with real values', () => {
    expect(isSensitiveSecret('JIRA_API_TOKEN', 'abcdefghij')).toBe(true);
  });

  it('ignores public settings and very short values', () => {
    expect(isSensitiveSecret('JIRA_SITE', 'acme.atlassian.net')).toBe(false);
    expect(isSensitiveSecret('DB_PASSWORD', 'short')).toBe(false);
  });
});
