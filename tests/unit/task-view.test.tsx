// @vitest-environment jsdom
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientFolders, detectEditor } from '../../src/main/editor';
import { parseNameStatus, taskFileDiff, taskRepoChanges } from '../../src/main/git-changes';
import { dataPaths } from '../../src/main/paths';
import { RepoPicker } from '../../src/renderer/src/components/RepoPicker';
import { taskJourney } from '../../src/renderer/src/lib/task-journey';
import { companySchema, taskSchema, type Company, type PullRequest, type Session, type Task } from '../../src/shared/schemas';

const PATH = process.env.PATH ?? '';
let dir: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-view-')));
});
afterEach(() => {
  cleanup();
  rmSync(dir, { recursive: true, force: true });
});

const company = (projects: { id: string; name: string; path: string }[] = []) => companySchema.parse({ id: 'c', name: 'Client', color: '#5BB8A6', projects });
const makeTask = (change: Record<string, unknown> = {}) => taskSchema.parse({ id: 't', companyId: 'c', title: 'Fix it', status: 'doing', createdAt: 'x', updatedAt: 'x', ...change });
const session = (state: Session['state']): Session => ({ id: 's', taskId: 't', companyId: 'c', accountId: 'a', cwd: '/x', state, startedAt: 'x', updatedAt: 'x' });
const pull = (change: Partial<PullRequest> = {}): PullRequest => ({
  projectId: 'api', repo: 'api', number: 7, title: 'Fix', url: 'https://x', state: 'open', draft: false, headSha: 'a', ci: 'passing', review: 'none', conflicts: false, failedChecks: [], comments: [], ...change,
});
const journey = (state: Session['state'] | null, pulls: PullRequest[] = [], change: Record<string, unknown> = {}) =>
  taskJourney({ task: makeTask(change), company: company(), session: state ? session(state) : undefined, pulls });

describe('where a task is and where it goes', () => {
  it('names the type of task', () => {
    expect(journey(null).kind).toBe('Your own task');
    expect(journey(null, [], { source: { kind: 'jira', key: 'ACME-1' } }).kind).toBe('Jira ticket ACME-1');
    expect(journey(null, [], { guide: { playbookId: 'b', name: 'Bug', steps: [{ name: 'Read', prompt: 'x' }], current: 0, promptPending: false } }).kind).toBe('Your own task, with the guide Bug');
  });

  it('follows the task from start to merged', () => {
    expect(journey(null, [], { status: 'todo' })).toMatchObject({ stage: 0, now: 'Not started', next: 'Start a session' });
    expect(journey('working')).toMatchObject({ stage: 1, now: 'Agent is working' });
    expect(journey('needs-input')).toMatchObject({ stage: 1, next: 'Answer the agent in the terminal' });
    const stageName = (item: ReturnType<typeof journey>) => item.stages[item.stage];
    const waiting = journey('stopped', [pull()]);
    expect(waiting).toMatchObject({ now: 'Waiting for review' });
    expect(stageName(waiting)).toBe('Waiting for merge');
    const failing = journey('stopped', [pull({ ci: 'failing' })]);
    expect(failing).toMatchObject({ now: 'CI failing', next: 'Give the failure to the agent, or fix it yourself' });
    expect(stageName(failing)).toBe('Team review');
    const approved = journey('stopped', [pull({ review: 'approved' })]);
    expect(approved).toMatchObject({ next: 'Merge the pull request' });
    expect(stageName(approved)).toBe('Waiting for merge');
    const merged = journey('stopped', [pull({ state: 'merged' })]);
    expect(merged).toMatchObject({ now: 'Ready to close', next: 'Close it, and remove its copy of the code' });
    expect(stageName(merged)).toBe('Merged');
    expect(journey('stopped', [], { status: 'done' })).toMatchObject({ finished: true, now: 'Done' });
  });

  it('offers the next step of the guide when paused', () => {
    const guide = { playbookId: 'b', name: 'Bug', steps: [{ name: 'Read', prompt: 'x' }, { name: 'Fix', prompt: 'y' }], current: 0, promptPending: false };
    expect(journey('stopped', [], { guide }).next).toBe('Next in the guide: Fix');
  });
});

describe('choosing repositories', () => {
  const projects = [{ id: 'api', name: 'api', path: '/a' }, { id: 'web', name: 'web', path: '/b' }];
  function Picker({ initial = [] as string[], list = projects }) {
    const [selected, setSelected] = useState(initial);
    return <RepoPicker company={company(list)} selected={selected} onChange={setSelected} />;
  }
  const column = (name: string) => within(screen.getByRole('region', { name }));

  it('moves a repository between the two lists, and back', async () => {
    render(<Picker />);
    expect(column('Not selected').getByRole('checkbox', { name: 'api' })).toBeTruthy();
    expect(column('Selected').queryByRole('checkbox')).toBeNull();
    expect(column('Selected').getByText('Check a repository to move it here.')).toBeTruthy();

    await userEvent.click(screen.getByRole('checkbox', { name: 'api' }));
    expect(column('Selected').getByRole<HTMLInputElement>('checkbox', { name: 'api' }).checked).toBe(true);
    expect(column('Not selected').queryByRole('checkbox', { name: 'api' })).toBeNull();
    expect(column('Not selected').getByRole('checkbox', { name: 'web' })).toBeTruthy();

    await userEvent.click(screen.getByRole('checkbox', { name: 'api' }));
    expect(column('Not selected').getByRole<HTMLInputElement>('checkbox', { name: 'api' }).checked).toBe(false);
    expect(column('Selected').queryByRole('checkbox')).toBeNull();
  });

  it('filters both lists', async () => {
    const many = Array.from({ length: 9 }, (_, index) => ({ id: `r${index}`, name: index === 0 ? 'gallery' : `repo-${index}`, path: `/${index}` }));
    render(<Picker initial={['r1']} list={many} />);
    await userEvent.type(screen.getByLabelText('Filter repositories'), 'gallery');
    expect(column('Not selected').getByRole('checkbox', { name: 'gallery' })).toBeTruthy();
    expect(column('Selected').getByText('None match this filter.')).toBeTruthy();
  });
});

describe('what a task changed', () => {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e.dev', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const makeRepo = (name: string) => {
    const path = join(dir, name);
    mkdirSync(path);
    git(path, 'init', '-q', '-b', 'main');
    writeFileSync(join(path, 'a.txt'), 'one\n');
    git(path, 'add', '.');
    git(path, 'commit', '-qm', 'first');
    return path;
  };

  it('reads renames and deletes from git', () => {
    expect(parseNameStatus('M\0a.ts\0R100\0old.ts\0new.ts\0D\0gone.ts\0A\0added.ts\0')).toEqual([
      { path: 'a.ts', status: 'modified' },
      { path: 'new.ts', status: 'renamed' },
      { path: 'gone.ts', status: 'deleted' },
      { path: 'added.ts', status: 'added' },
    ]);
  });

  const isolatedTask = (api: string, baseCommit: string, extra: Record<string, unknown> = {}): Task =>
    makeTask({ isolated: true, projectIds: ['api', 'web'], worktrees: [{ projectId: 'api', path: api, branch: 'hatstand/x', base: 'origin/main', baseCommit }], ...extra });

  it('lists only the repositories this task changed, with committed work too', async () => {
    const api = makeRepo('api');
    const web = makeRepo('web');
    const baseCommit = git(api, 'rev-parse', 'HEAD');
    git(api, 'switch', '-qc', 'hatstand/x');
    writeFileSync(join(api, 'done.txt'), 'done\n');
    git(api, 'add', '.');
    git(api, 'commit', '-qm', 'work');
    writeFileSync(join(api, 'pending.txt'), 'pending\n');
    writeFileSync(join(web, 'someone-else.txt'), 'not this task\n');
    const client: Company = company([{ id: 'api', name: 'api', path: join(dir, 'original') }, { id: 'web', name: 'web', path: web }]);

    const reports = await taskRepoChanges(client, isolatedTask(api, baseCommit), PATH, null);

    expect(reports.map((report) => report.name)).toEqual(['api']);
    expect(reports[0]?.changes).toEqual([{ path: 'pending.txt', status: 'untracked' }]);
    expect(reports[0]?.committed).toEqual([{ path: 'done.txt', status: 'added' }]);
    expect(reports[0]?.commits).toBe(1);
    expect(await taskFileDiff(client, isolatedTask(api, baseCommit), 'api', 'done.txt', PATH)).toContain('+done');
    expect(await taskFileDiff(client, isolatedTask(api, baseCommit), 'api', 'pending.txt', PATH)).toContain('+pending');
    await expect(taskFileDiff(client, isolatedTask(api, baseCommit), 'api', 'a.txt', PATH)).rejects.toThrow('no longer has changes');
  });

  it('lists nothing for a task whose copy has no work', async () => {
    const api = makeRepo('api');
    const web = makeRepo('web');
    writeFileSync(join(web, 'other.txt'), 'x\n');
    const client = company([{ id: 'api', name: 'api', path: api }, { id: 'web', name: 'web', path: web }]);
    expect(await taskRepoChanges(client, isolatedTask(api, git(api, 'rev-parse', 'HEAD')), PATH, null)).toEqual([]);
  });

  it('does not blame a task for the original checkout once its copy is gone', async () => {
    const api = makeRepo('api');
    writeFileSync(join(api, 'other.txt'), 'x\n');
    const client = company([{ id: 'api', name: 'api', path: api }]);
    expect(await taskRepoChanges(client, makeTask({ isolated: true, projectIds: ['api'] }), PATH, null)).toEqual([]);
  });

  it('in the shared folder, skips selected repositories without changes', async () => {
    const api = makeRepo('api');
    const web = makeRepo('web');
    writeFileSync(join(api, 'edit.txt'), 'x\n');
    const client = company([{ id: 'api', name: 'api', path: api }, { id: 'web', name: 'web', path: web }]);
    const reports = await taskRepoChanges(client, makeTask({ isolated: false, projectIds: ['api', 'web'] }), PATH, new Date(0).toISOString());
    expect(reports.map((report) => report.name)).toEqual(['api']);
  });

  it('in the shared folder, separates what was already changed before the agent started', async () => {
    const api = makeRepo('api');
    const web = makeRepo('web');
    const started = new Date('2026-06-01T00:00:00Z');
    const older = new Date('2026-05-01T00:00:00Z');
    const newer = new Date('2026-06-02T00:00:00Z');
    writeFileSync(join(api, 'old.txt'), 'x\n');
    writeFileSync(join(api, 'new.txt'), 'x\n');
    writeFileSync(join(web, 'only-old.txt'), 'x\n');
    utimesSync(join(api, 'old.txt'), older, older);
    utimesSync(join(api, 'new.txt'), newer, newer);
    utimesSync(join(web, 'only-old.txt'), older, older);
    const client = company([{ id: 'api', name: 'api', path: api }, { id: 'web', name: 'web', path: web }]);
    const shared = makeTask({ isolated: false, projectIds: ['api', 'web'] });
    const [apiReport, webReport] = await taskRepoChanges(client, shared, PATH, started.toISOString());
    expect(apiReport?.changes.map((change) => change.path)).toEqual(['new.txt']);
    expect(apiReport?.before.map((change) => change.path)).toEqual(['old.txt']);
    expect(webReport?.changes).toEqual([]);
    expect(webReport?.before.map((change) => change.path)).toEqual(['only-old.txt']);
  });

  it('treats everything as older when no agent has worked on the task', async () => {
    const api = makeRepo('api');
    writeFileSync(join(api, 'edit.txt'), 'x\n');
    const client = company([{ id: 'api', name: 'api', path: api }]);
    const [report] = await taskRepoChanges(client, makeTask({ isolated: false, projectIds: ['api'] }), PATH, null);
    expect(report?.changes).toEqual([]);
    expect(report?.before.map((change) => change.path)).toEqual(['edit.txt']);
  });
});

describe('opening the client in an editor', () => {
  it('prefers VS Code, then others, and finds the app when the command is not installed', () => {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'cursor'), '#!/bin/sh\n', { mode: 0o755 });
    expect(detectEditor(bin, () => false)?.name).toBe('Cursor');
    writeFileSync(join(bin, 'code'), '#!/bin/sh\n', { mode: 0o755 });
    expect(detectEditor(bin, () => false)?.name).toBe('VS Code');
    expect(detectEditor(join(dir, 'none'), () => false)).toBeNull();
    expect(detectEditor(join(dir, 'none'), (file) => file.includes('Cursor'))?.name).toBe('Cursor');
  });

  it('lists every existing folder of the client once', () => {
    const paths = dataPaths(join(dir, 'home'));
    const repo = join(dir, 'api');
    mkdirSync(repo);
    mkdirSync(paths.knowledgeDir('c'), { recursive: true });
    const client = companySchema.parse({
      id: 'c', name: 'Client', color: '#5BB8A6',
      projects: [{ id: 'api', name: 'api', path: repo }, { id: 'gone', name: 'gone', path: join(dir, 'gone') }],
      context: { knowledgeDir: paths.knowledgeDir('c') },
    });
    expect(clientFolders(paths, client)).toEqual([{ name: 'api', path: repo }, { name: 'Knowledge', path: paths.knowledgeDir('c') }]);
  });
});
