import { describe, expect, it } from 'vitest';
import { GITHUB_HOST, parseRepoLink, type GitHost } from '../../src/shared/git-source';

const GITLAB: GitHost = { provider: 'gitlab', host: 'gitlab.acme.dev' };

describe('reading the link of a repository', () => {
  it.each([
    'https://github.com/acme/api',
    'https://github.com/acme/api.git',
    'https://github.com/acme/api/',
    '  github.com/acme/api  ',
    'git@github.com:acme/api.git',
    'ssh://git@github.com/acme/api.git',
    'https://github.com/acme/api/tree/main/src',
    'https://github.com/acme/api/pull/12',
  ])('reads %s as the repository acme/api', (link) => {
    expect(parseRepoLink(link, GITHUB_HOST)).toEqual({ cloneUrl: 'https://github.com/acme/api.git', name: 'api' });
  });

  it('keeps the subgroups of a GitLab repository, and drops the page inside it', () => {
    const expected = { cloneUrl: 'https://gitlab.acme.dev/acme/payments/api.git', name: 'api' };
    expect(parseRepoLink('https://gitlab.acme.dev/acme/payments/api', GITLAB)).toEqual(expected);
    expect(parseRepoLink('https://gitlab.acme.dev/acme/payments/api/-/merge_requests/4', GITLAB)).toEqual(expected);
    expect(parseRepoLink('git@gitlab.acme.dev:acme/payments/api.git', GITLAB)).toEqual(expected);
  });

  it.each([
    'https://gitlab.com/acme/api',
    'https://github.com.example.com/acme/api',
    'http://github.com/acme/api',
    'git@example.com:acme/api.git',
  ])('refuses %s, which is not on the site of the client', (link) => {
    expect(() => parseRepoLink(link, GITHUB_HOST)).toThrow('this link is on another site');
  });

  it('refuses a link that carries a user or a password, without repeating them', () => {
    const read = () => parseRepoLink('https://someone:hunter2@github.com/acme/api', GITHUB_HOST);
    expect(read).toThrow('Remove the user and password from the link.');
    expect(read).not.toThrow(/hunter2/);
  });

  it.each(['', 'not a link', 'https://github.com', 'https://github.com/acme', 'https://github.com/acme/-api', 'https://github.com/acme/.git'])(
    'says that "%s" is not a repository',
    (link) => {
      expect(() => parseRepoLink(link, GITHUB_HOST)).toThrow('This is not the link of a repository.');
    },
  );

  it('never leaves the folder it downloads to', () => {
    expect(() => parseRepoLink('https://gitlab.acme.dev/acme/%2E%2E/api', GITLAB)).toThrow();
    expect(parseRepoLink('https://gitlab.acme.dev/acme/../other/api', GITLAB).name).toBe('api');
  });
});
