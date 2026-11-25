import { describe, expect, it } from 'vitest';
import { pathFromLink } from '../../src/renderer/src/lib/path-links';

describe('the file a link points to', () => {
  it.each([
    ['/data/tasks/t.plan.md', '/data/tasks/t.plan.md'],
    ['  /code/api/src/login.ts  ', '/code/api/src/login.ts'],
    ['/code/api/src/login.ts:12', '/code/api/src/login.ts'],
    ['/code/api/src/login.ts:12:4', '/code/api/src/login.ts'],
    ['/data/tasks/t.plan.md.', '/data/tasks/t.plan.md'],
    ['file:///data/my%20notes/plan.md', '/data/my notes/plan.md'],
    ['/data/my notes/plan.md', '/data/my notes/plan.md'],
  ])('reads %s', (text, path) => {
    expect(pathFromLink(text)).toBe(path);
  });

  it.each(['https://example.com/a/b', 'src/login.ts', './plan.md', '~/plan.md', '/', '/tmp', '//example.com/a/b', 'pnpm test', '', 'file://%E0%A4%A'])('finds none in %s', (text) => {
    expect(pathFromLink(text)).toBeNull();
  });

  it('finds none without text', () => {
    expect(pathFromLink(undefined)).toBeNull();
  });
});
