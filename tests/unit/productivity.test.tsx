// @vitest-environment jsdom
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocument, listClientFiles, readClientFile } from '../../src/main/client-files';
import { fileDiff, parseGitStatus, repoChanges } from '../../src/main/git-changes';
import { dataPaths } from '../../src/main/paths';
import { searchWorkspace, snippet } from '../../src/main/search';
import { shouldStayAwake, StayAwake } from '../../src/main/stay-awake';
import { Store } from '../../src/main/store';
import { CommandPalette } from '../../src/renderer/src/components/CommandPalette';
import { DocumentsPage } from '../../src/renderer/src/components/DocumentsPage';
import { moveClient } from '../../src/renderer/src/lib/client-order';
import type { Bridge, ClientFile, Snapshot } from '../../src/shared/api';
import { companySchema, taskSchema, type Company, type Task } from '../../src/shared/schemas';

const invoke = vi.fn();
Element.prototype.scrollIntoView = vi.fn();
let dir: string;

const company = (id: string, change: Partial<Company> = {}): Company => companySchema.parse({ id, name: id, color: '#5BB8A6', createdAt: '', ...change });
const task = (id: string, title: string, companyId = 'acme'): Task => taskSchema.parse({ id, companyId, title, status: 'todo', createdAt: '', updatedAt: '' });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hatstand-productivity-'));
  invoke.mockReset();
  window.hatstand = { invoke, on: () => () => {} } as unknown as Bridge;
});

afterEach(() => {
  cleanup();
  rmSync(dir, { recursive: true, force: true });
});

describe('stay awake', () => {
  it('follows the chosen mode and the running sessions', () => {
    expect(shouldStayAwake('off', 3)).toBe(false);
    expect(shouldStayAwake('sessions', 0)).toBe(false);
    expect(shouldStayAwake('sessions', 1)).toBe(true);
    expect(shouldStayAwake('always', 0)).toBe(true);
  });

  it('holds one blocker, and releases it', () => {
    const blocker = { start: vi.fn(() => 7), stop: vi.fn() };
    const awake = new StayAwake(blocker);
    awake.apply(true);
    awake.apply(true);
    expect(blocker.start).toHaveBeenCalledTimes(1);
    expect(blocker.start).toHaveBeenCalledWith('prevent-display-sleep');
    expect(awake.active).toBe(true);
    awake.apply(false);
    awake.apply(false);
    expect(blocker.stop).toHaveBeenCalledTimes(1);
    expect(blocker.stop).toHaveBeenCalledWith(7);
    expect(awake.active).toBe(false);
  });
});

describe('client order', () => {
  it('moves a client up or down onto the target position', () => {
    expect(moveClient(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(moveClient(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
    expect(moveClient(['a', 'b', 'c'], 'a', 'b')).toEqual(['b', 'a', 'c']);
    expect(moveClient(['a', 'b'], 'a', 'a')).toEqual(['a', 'b']);
    expect(moveClient(['a', 'b'], 'x', 'a')).toEqual(['a', 'b']);
  });

  it('is kept outside the clients, and new clients go last in name order', () => {
    const store = new Store(dataPaths(dir));
    for (const name of ['Delta', 'Alpha', 'Beta']) store.createCompany(name, '#5BB8A6');
    const names = () => store.listCompanies().map((item) => item.name);
    expect(names()).toEqual(['Alpha', 'Beta', 'Delta']);
    store.savePreferences({ clientOrder: ['delta', 'alpha'] });
    expect(names()).toEqual(['Delta', 'Alpha', 'Beta']);
    expect(store.readPreferences().stayAwake).toBe('off');
  });
});

describe('search', () => {
  const sources = (files: ClientFile[] = []) => ({
    companies: [company('acme', { projects: [{ id: 'api', name: 'uploads-api', path: '/code/uploads-api' }] }), company('old', { archivedAt: '2026-01-01' })],
    tasks: [task('t1', 'Fix the export'), task('t2', 'Other work'), task('t3', 'Fix archived client', 'old')],
    readNotes: (item: Task) => (item.id === 't2' ? 'Falta la revisión de imágenes' : ''),
    listFiles: (item: Company) => (item.id === 'acme' ? files : [{ path: '/nowhere/old.md', name: 'fix.md', folder: '/', scope: 'knowledge' as const }]),
  });

  it('finds titles first, then notes, ignoring accents and case', async () => {
    const titles = await searchWorkspace('FIX', sources());
    expect(titles.results.map((item) => item.title)).toEqual(['Fix the export']);
    const notes = await searchWorkspace('revision IMAGENES', sources());
    expect(notes.results[0]).toMatchObject({ kind: 'task', taskId: 't2' });
    expect(notes.results[0]?.snippet).toContain('revisión');
  });

  it('finds repositories, file names and file contents, and leaves archived clients out', async () => {
    const spec = join(dir, 'spec.md');
    writeFileSync(spec, 'The media must load every night.');
    const files: ClientFile[] = [{ path: spec, name: 'spec.md', folder: dir, scope: 'planning' }, { path: join(dir, 'gone.md'), name: 'gone.md', folder: dir, scope: 'planning' }];
    expect((await searchWorkspace('uploads', sources(files))).results[0]).toMatchObject({ kind: 'repo', path: '/code/uploads-api' });
    expect((await searchWorkspace('spec.md', sources(files))).results[0]).toMatchObject({ kind: 'file', scope: 'planning' });
    const inside = await searchWorkspace('media must', sources(files));
    expect(inside.results[0]).toMatchObject({ kind: 'file', title: 'spec.md' });
    expect(inside.results[0]?.snippet).toContain('media');
    expect((await searchWorkspace('archived', sources(files))).results).toEqual([]);
  });

  it('ignores a query that is too short, and says when it stopped reading early', async () => {
    expect((await searchWorkspace(' a ', sources())).results).toEqual([]);
    const spec = join(dir, 'late.md');
    writeFileSync(spec, 'needle');
    const late = await searchWorkspace('needle', { ...sources([{ path: spec, name: 'late.md', folder: dir, scope: 'planning' }]), budgetMs: -1 });
    expect(late.partial).toBe(true);
  });

  it('cuts a snippet around the match', () => {
    expect(snippet(`${'x'.repeat(200)} needle ${'y'.repeat(200)}`, ['needle'])).toMatch(/^….*needle.*…$/);
    expect(snippet('nothing here', ['needle'])).toBeUndefined();
  });
});

describe('the planning status in Documents', () => {
  const status = (isRepo: boolean) => ({ projectId: 'planning', name: 'Planning repository', path: '/plans', committed: [], before: [], commits: 0, isRepo, branch: isRepo ? 'main' : null, changes: [], truncated: false });
  const show = (isRepo: boolean) => {
    invoke.mockImplementation(async (method: string) => (method === 'planningStatus' ? status(isRepo) : []));
    render(<DocumentsPage snapshot={{ tasks: [] } as unknown as Snapshot} company={company('acme', { planning: { path: '/plans', places: [] } })} onOpenClient={vi.fn()} onOpenTask={vi.fn(async () => {})} />);
  };

  it('says when a saved folder is not a git repository', async () => {
    show(false);
    await screen.findByText(/this folder is not a git repository/);
    expect(screen.queryByText(/everything committed/)).toBeNull();
  });

  it('says everything is committed in a clean repository', async () => {
    show(true);
    await screen.findByText(/on main: everything committed/);
  });
});

describe('documents', () => {
  const planned = () => {
    const paths = dataPaths(join(dir, 'home'));
    const repo = join(dir, 'specs');
    mkdirSync(join(repo, 'docs'), { recursive: true });
    return { paths, repo, client: company('acme', { planning: { path: repo, places: [{ name: 'Specs', folder: 'specs' }] } }) };
  };

  it('creates a document in a planning place, and lists and reads it', () => {
    const { paths, repo, client } = planned();
    const file = createDocument(paths, client, 'specs', 'Plan de viaje');
    expect(file).toBe(join(repo, 'specs', 'Plan de viaje.md'));
    expect(readFileSync(file, 'utf8')).toBe('# Plan de viaje\n');
    expect(listClientFiles(paths, client).find((item) => item.path === file)?.scope).toBe('planning');
    expect(readClientFile(paths, client, file).content).toBe('# Plan de viaje\n');
  });

  it('keeps private documents in knowledge, outside the repository', () => {
    const { paths, repo, client } = planned();
    const file = createDocument(paths, client, 'knowledge', 'notes.md');
    expect(file.startsWith(paths.knowledgeDir('acme'))).toBe(true);
    expect(file.startsWith(repo)).toBe(false);
  });

  it('refuses a folder that is not a place, a path in the name, a binary file, or an existing name', () => {
    const { paths, repo, client } = planned();
    expect(() => createDocument(paths, client, '../..', 'x')).toThrow(/where to save/);
    expect(() => createDocument(paths, client, 'docs', 'x')).toThrow(/where to save/);
    expect(() => createDocument(paths, client, 'specs', '../../evil')).toThrow(/letters, numbers/);
    expect(() => createDocument(paths, client, 'specs', 'tool.exe')).toThrow(/text file/);
    createDocument(paths, client, 'specs', 'once');
    expect(() => createDocument(paths, client, 'specs', 'once')).toThrow(/already/);
    expect(existsSync(join(repo, '..', 'evil.md'))).toBe(false);
    expect(() => createDocument(paths, company('acme'), 'specs', 'x')).toThrow(/where to save/);
  });
});

describe('git changes', () => {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  const path = process.env.PATH ?? '';

  const repoWithChanges = () => {
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'fake@example.invalid');
    git(dir, 'config', 'user.name', 'Fake');
    writeFileSync(join(dir, 'app.txt'), 'one\ntwo\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'start');
    writeFileSync(join(dir, 'app.txt'), 'one\nthree\n');
    writeFileSync(join(dir, 'new file.txt'), 'hello\n');
  };

  it('reads each kind of status, with renames counted once', () => {
    expect(parseGitStatus(' M a.txt\0A  b.txt\0D  c.txt\0R  new.txt\0old.txt\0?? d e.txt\0')).toEqual([
      { path: 'a.txt', status: 'modified' },
      { path: 'b.txt', status: 'added' },
      { path: 'c.txt', status: 'deleted' },
      { path: 'new.txt', status: 'renamed' },
      { path: 'd e.txt', status: 'untracked' },
    ]);
  });

  it('lists changes and shows their diff', async () => {
    repoWithChanges();
    const report = await repoChanges(dir, path);
    expect(report.isRepo).toBe(true);
    expect(report.changes.map((item) => item.path).sort()).toEqual(['app.txt', 'new file.txt']);
    const diff = await fileDiff(dir, 'app.txt', path);
    expect(diff).toContain('+three');
    expect(diff).toContain('-two');
    expect(await fileDiff(dir, 'new file.txt', path)).toBe('+hello');
  });

  it('only reads files that git reports as changed', async () => {
    repoWithChanges();
    writeFileSync(join(dir, '..', 'outside.txt'), 'private');
    await expect(fileDiff(dir, '../outside.txt', path)).rejects.toThrow(/no longer has changes/);
    rmSync(join(dir, '..', 'outside.txt'));
  });

  it('reports a folder that is not a repository', async () => {
    expect(await repoChanges(dir, path)).toEqual({ isRepo: false, branch: null, changes: [], truncated: false });
  });
});

describe('CommandPalette', () => {
  const snapshot = { companies: [company('acme')], tasks: [], sessions: [], accounts: { accounts: [] } } as unknown as Snapshot;
  const run = vi.fn();
  const commands = [{ id: 'new', title: 'New task', run }, { id: 'settings', title: 'Open settings', run: vi.fn() }];

  it('runs the chosen action with the keyboard, and closes', async () => {
    const onClose = vi.fn();
    run.mockReset();
    render(<CommandPalette snapshot={snapshot} commands={commands} onResult={vi.fn()} onClose={onClose} />);
    await userEvent.keyboard('{Enter}');
    expect(run).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('filters actions, moves the selection, and closes with Escape', async () => {
    const onClose = vi.fn();
    render(<CommandPalette snapshot={snapshot} commands={commands} onResult={vi.fn()} onClose={onClose} />);
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Open settings' }).getAttribute('aria-selected')).toBe('true');
    await userEvent.type(screen.getByRole('combobox'), 'sett');
    expect(screen.queryByRole('option', { name: 'New task' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows search results and hands the chosen one back', async () => {
    const onResult = vi.fn();
    const hit = { kind: 'task', taskId: 't1', companyId: 'acme', title: 'Fix the export', client: 'Acme', snippet: 'in the notes' };
    invoke.mockImplementation(async (method: string) => (method === 'searchEverything' ? { results: [hit], partial: false } : undefined));
    render(<CommandPalette snapshot={snapshot} commands={commands} onResult={onResult} onClose={vi.fn()} />);
    await userEvent.type(screen.getByRole('combobox'), 'export');
    const option = await screen.findByRole('option', { name: /Fix the export/ });
    expect(option.textContent).toContain('in the notes');
    await userEvent.click(option);
    expect(onResult).toHaveBeenCalledWith(hit);
  });
});
