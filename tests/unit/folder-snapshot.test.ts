import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diffSnapshots, SKIPPED_FOLDERS, snapshotFolders, SNAPSHOT_LIMITS } from '../../src/main/folder-snapshot';

let dir: string;
const LONG_AGO = new Date('2020-01-01T00:00:00Z');

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-snapshot-')));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Writes a file as if it had been there for years, so only a later change makes it look written in the turn. */
const old = (path: string, content = 'x') => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
  utimesSync(join(dir, path), LONG_AGO, LONG_AGO);
};
const fresh = (path: string, content = 'x') => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
};
const names = (snapshot: { files: Record<string, unknown> }) => Object.keys(snapshot.files).map((file) => file.slice(dir.length + 1)).sort();
const byPath = (changes: { path: string; status: string }[]) => Object.fromEntries(changes.map((change) => [change.path.slice(dir.length + 1), change.status]));

describe('a snapshot of folders', () => {
  it('lists the files with their time and size, at any depth', async () => {
    old('notes.md', 'hello');
    old('plans/q3/roadmap.md');
    const snapshot = await snapshotFolders([dir]);
    expect(names(snapshot)).toEqual(['notes.md', 'plans/q3/roadmap.md']);
    expect(snapshot.files[join(dir, 'notes.md')]).toEqual({ mtimeMs: LONG_AGO.getTime(), size: 5 });
    expect(snapshot.truncated).toBe(false);
  });

  it('leaves out heavy folders, and the folders it is told to skip', async () => {
    old('keep.md');
    for (const folder of SKIPPED_FOLDERS) old(`${folder}/inside.txt`);
    old('code/api/src/index.ts');
    old('.DS_Store');
    expect(SKIPPED_FOLDERS).toEqual(expect.arrayContaining(['.git', 'node_modules']));
    expect(names(await snapshotFolders([dir], { skip: [join(dir, 'code', 'api')] }))).toEqual(['keep.md']);
  });

  it('leaves out the files it is told to ignore', async () => {
    old('tasks/t1.json');
    old('tasks/t1.md');
    expect(names(await snapshotFolders([dir], { ignore: (file) => file.endsWith('.json') }))).toEqual(['tasks/t1.md']);
  });

  it('notes which folders are git repositories', async () => {
    old('docs/readme.md');
    old('tool/.git/HEAD');
    old('tool/main.py');
    const snapshot = await snapshotFolders([dir]);
    expect(snapshot.repos).toEqual([join(dir, 'tool')]);
    expect(names(snapshot)).toEqual(['docs/readme.md', 'tool/main.py']);
  });

  it('stops at the file limit and says so, instead of reading a large folder to the end', async () => {
    for (let index = 0; index < 12; index += 1) old(`many/file-${String(index).padStart(2, '0')}.txt`);
    const cut = await snapshotFolders([dir], { limits: { maxFiles: 5, maxDepth: 8 } });
    expect(Object.keys(cut.files)).toHaveLength(5);
    expect(cut.truncated).toBe(true);
    const whole = await snapshotFolders([dir], { limits: { maxFiles: 12, maxDepth: 8 } });
    expect(Object.keys(whole.files)).toHaveLength(12);
    expect(whole.truncated).toBe(false);
  });

  it('has a default file limit, so a folder with more files is cut short', async () => {
    expect(SNAPSHOT_LIMITS.maxFiles).toBeLessThanOrEqual(5000);
    mkdirSync(join(dir, 'big'));
    for (let index = 0; index <= SNAPSHOT_LIMITS.maxFiles; index += 1) writeFileSync(join(dir, 'big', `f${index}`), '');
    const snapshot = await snapshotFolders([dir]);
    expect(Object.keys(snapshot.files)).toHaveLength(SNAPSHOT_LIMITS.maxFiles);
    expect(snapshot.truncated).toBe(true);
  });

  it('stops at the depth limit and says so', async () => {
    old('a/b/c/deep.md');
    old('a/top.md');
    const snapshot = await snapshotFolders([dir], { limits: { maxFiles: 100, maxDepth: 1 } });
    expect(names(snapshot)).toEqual(['a/top.md']);
    expect(snapshot.truncated).toBe(true);
  });

  it('is empty for a folder that is gone', async () => {
    expect(await snapshotFolders([join(dir, 'missing')])).toMatchObject({ files: {}, repos: [], truncated: false });
  });
});

describe('what changed between two snapshots', () => {
  it('finds the files created, modified and deleted', async () => {
    old('same.md');
    old('edited.md', 'before');
    old('removed.md');
    const before = await snapshotFolders([dir]);
    fresh('edited.md', 'after, and longer');
    fresh('notes/created.md');
    rmSync(join(dir, 'removed.md'));
    const { changes, truncated } = diffSnapshots(before, await snapshotFolders([dir]));
    expect(byPath(changes)).toEqual({ 'edited.md': 'modified', 'notes/created.md': 'added', 'removed.md': 'deleted' });
    expect(truncated).toBe(false);
  });

  it('reports each change with its full path', async () => {
    const before = await snapshotFolders([dir]);
    fresh('notes/created.md');
    expect(diffSnapshots(before, await snapshotFolders([dir])).changes).toEqual([{ path: join(dir, 'notes', 'created.md'), status: 'added' }]);
  });

  it('counts a file written while the first snapshot was being taken', async () => {
    old('long-there.md');
    const turnStarted = Date.now() - 1000;
    fresh('early.md');
    const before = await snapshotFolders([dir], { since: turnStarted });
    expect(byPath(diffSnapshots(before, await snapshotFolders([dir])).changes)).toEqual({ 'early.md': 'modified' });
  });

  it('reports a new repository as one entry, without its files', async () => {
    old('docs/readme.md');
    const before = await snapshotFolders([dir]);
    fresh('tool/.git/HEAD');
    fresh('tool/main.py');
    fresh('tool/lib/util.py');
    expect(diffSnapshots(before, await snapshotFolders([dir])).changes).toEqual([{ path: join(dir, 'tool'), status: 'repository' }]);
  });

  it('keeps reporting the files of a repository that was already there', async () => {
    old('tool/.git/HEAD');
    old('tool/main.py');
    const before = await snapshotFolders([dir]);
    fresh('tool/main.py', 'changed');
    expect(byPath(diffSnapshots(before, await snapshotFolders([dir])).changes)).toEqual({ 'tool/main.py': 'modified' });
  });

  it('does not invent changes when a snapshot was cut short', async () => {
    for (const name of ['a', 'b', 'c', 'd']) old(`${name}.md`);
    const limits = { maxFiles: 3, maxDepth: 8 };
    const before = await snapshotFolders([dir], { limits });
    rmSync(join(dir, 'a.md'));
    fresh('e.md');
    // After the deletion the cut moves: d.md is read now, and was not before. It is old, so it is not new.
    const { changes, truncated } = diffSnapshots(before, await snapshotFolders([dir], { limits }));
    expect(changes).toEqual([]);
    expect(truncated).toBe(true);
  });

  it('still reports what was written in the turn when a snapshot was cut short', async () => {
    for (const name of ['b', 'c', 'd']) old(`${name}.md`);
    const limits = { maxFiles: 3, maxDepth: 8 };
    const before = await snapshotFolders([dir], { limits });
    fresh('a.md');
    expect(byPath(diffSnapshots(before, await snapshotFolders([dir], { limits })).changes)).toEqual({ 'a.md': 'added' });
  });
});
