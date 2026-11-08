// @vitest-environment jsdom
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../../src/main/agents/task-prompt';
import { createDocument, listClientFiles } from '../../src/main/client-files';
import { applyGitIdentity, gitIdentityStatus, identityEnv, previewGitIdentity } from '../../src/main/git-identity';
import { dataPaths } from '../../src/main/paths';
import { Store } from '../../src/main/store';
import { workingDirFor } from '../../src/main/task-folders';
import { LinksEditor } from '../../src/renderer/src/components/LinksEditor';
import { byPriority, inboxOrder } from '../../src/renderer/src/lib/inbox';
import { taskJourney } from '../../src/renderer/src/lib/task-journey';
import { pasteAsOne, splitPaste } from '../../src/shared/inbox-paste';
import { clientReadiness, hasWorkspace } from '../../src/shared/readiness';
import { clientLinkSchema, companySchema, taskSchema, type ClientLink } from '../../src/shared/schemas';

const PATH = process.env.PATH ?? '';
let dir: string;
const savedEnv = { HOME: process.env.HOME, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL };

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-clients-')));
  process.env.HOME = dir;
  process.env.GIT_CONFIG_GLOBAL = join(dir, '.gitconfig');
});
afterEach(() => {
  cleanup();
  process.env.HOME = savedEnv.HOME;
  if (savedEnv.GIT_CONFIG_GLOBAL === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = savedEnv.GIT_CONFIG_GLOBAL;
  rmSync(dir, { recursive: true, force: true });
});

const makeTask = (change: Record<string, unknown> = {}) => taskSchema.parse({ id: 't', companyId: 'c', title: 'Fix it', status: 'doing', createdAt: 'x', updatedAt: 'x', ...change });
const company = (change: Record<string, unknown> = {}) => companySchema.parse({ id: 'c', name: 'Client', color: '#5BB8A6', ...change });

describe('pasting a list with sublists', () => {
  it('makes the sublist a checklist of its parent', () => {
    const ideas = splitPaste('- Fix the login\n  - Reproduce it\n  - Write a test\n- Review the report\n');
    expect(ideas).toEqual([
      { title: 'Fix the login', description: '', checklist: ['Reproduce it', 'Write a test'] },
      { title: 'Review the report', description: '' },
    ]);
  });

  it('understands tabs, numbers, letters, checkboxes and deeper levels', () => {
    const ideas = splitPaste('1. Parent\n\ta. first\n\tb) second\n\t- [ ] third\n\t\t- fourth');
    expect(ideas).toHaveLength(1);
    expect(ideas[0]?.checklist).toEqual(['first', 'second', 'third', 'fourth']);
  });

  it('does not treat a list that is indented as a whole as a sublist', () => {
    expect(splitPaste('  - One\n  - Two').map((idea) => idea.title)).toEqual(['One', 'Two']);
  });

  it('keeps indented text without a marker as the description', () => {
    expect(splitPaste('Parent\n  more about it')).toEqual([{ title: 'Parent', description: 'more about it' }]);
  });

  it('can still keep everything as one task', () => {
    expect(pasteAsOne('Parent\n  - sub')?.title).toBe('Parent');
  });
});

describe('writing the inbox in Markdown', () => {
  it('makes a title a task and the list inside it its checklist', () => {
    expect(splitPaste('# Fix the login\n- Reproduce it\n- Write a test\n\n## Review the report\n1. Check the totals')).toEqual([
      { title: 'Fix the login', description: '', checklist: ['Reproduce it', 'Write a test'] },
      { title: 'Review the report', description: '', checklist: ['Check the totals'] },
    ]);
  });

  it('flattens sublists inside a title into one checklist', () => {
    expect(splitPaste('# Parent\n- first\n  - second\n- third')[0]?.checklist).toEqual(['first', 'second', 'third']);
  });

  it('does not make a new task only because of a new line', () => {
    expect(splitPaste('Fix the login\nIt fails on Safari\n\nOnly after a refresh')).toEqual([{ title: 'Fix the login', description: 'It fails on Safari\nOnly after a refresh' }]);
  });

  it('keeps lines after a list item as its description', () => {
    expect(splitPaste('- one\nmore about one\n- two')).toEqual([
      { title: 'one', description: 'more about one' },
      { title: 'two', description: '' },
    ]);
  });

  it('treats a first line without a marker as a title for the list below it', () => {
    expect(splitPaste('Fix the login\n- Reproduce it\n- Write a test')).toEqual([{ title: 'Fix the login', description: '', checklist: ['Reproduce it', 'Write a test'] }]);
  });

  it('starts a new task at each title, after a list', () => {
    expect(splitPaste('- one\n  - sub\n# two\n- item').map((idea) => [idea.title, idea.checklist])).toEqual([
      ['one', ['sub']],
      ['two', ['item']],
    ]);
  });

  it('understands bullets pasted from documents and any indentation', () => {
    expect(splitPaste('• Parent\n ◦ first\n   ▪ second')[0]?.checklist).toEqual(['first', 'second']);
  });
});

describe('order and priority', () => {
  const task = (id: string, change: Record<string, unknown> = {}) => makeTask({ id, ...change });

  it('follows the chosen order, then the newest', () => {
    const items = [task('old', { createdAt: '1' }), task('new', { createdAt: '2' }), task('second', { rank: 1 }), task('first', { rank: 0 })];
    expect(inboxOrder(items).map((item) => item.id)).toEqual(['first', 'second', 'new', 'old']);
  });

  it('sorts by priority and keeps the order inside each priority', () => {
    const items = [task('a'), task('b', { priority: 'low' }), task('c', { priority: 'high' }), task('d', { priority: 'high' }), task('e', { priority: 'medium' })];
    expect(byPriority(items).map((item) => item.id)).toEqual(['c', 'd', 'e', 'b', 'a']);
  });
});

describe('clients without code', () => {
  it('can start work with only an area, and do not need commit protection', () => {
    const client = company({ subdomains: [{ id: 'p', name: 'Reports' }] });
    expect(hasWorkspace(client)).toBe(true);
    const readiness = clientReadiness({ company: client, secretNames: ['GITHUB_TOKEN'], hasLocalKnowledge: true, hasLocalPlugin: true, hasStarterInstructions: false });
    expect(readiness.percent).toBe(100);
    expect(readiness.items.map((item) => item.id)).not.toContain('protection');
  });

  it('works in the private folder of the area when the client has no repositories', () => {
    const paths = dataPaths(join(dir, 'home'));
    const noCode = company({ subdomains: [{ id: 'p', name: 'Reports' }] });
    expect(workingDirFor(paths, noCode, makeTask({ subdomainId: 'p' }))).toBe(paths.areaDir('c', 'p'));
  });

  it('keeps tasks of a client with code in its folder, with or without repositories selected', () => {
    const paths = dataPaths(join(dir, 'home'));
    const client = company({ rootDir: dir, projects: [{ id: 'api', name: 'api', path: dir }], subdomains: [{ id: 'p', name: 'Uploads' }] });
    expect(workingDirFor(paths, client, makeTask({ subdomainId: 'p' }))).toBe(dir);
    expect(workingDirFor(paths, client, makeTask({ subdomainId: 'p', projectIds: ['api'] }))).toBe(dir);
  });

  it('shows a path without review or merge', () => {
    const journey = taskJourney({ task: makeTask(), company: company(), session: undefined, pulls: [] });
    expect(journey.stages).toEqual(['Not started', 'In progress', 'Done']);
    const done = taskJourney({ task: makeTask({ status: 'done' }), company: company(), session: undefined, pulls: [] });
    expect(done.stage).toBe(2);
  });

  it('gives every area its private files, also one that came from suggestions', () => {
    const paths = dataPaths(join(dir, 'home'));
    const store = new Store(paths);
    const client = store.createCompany('Client', '#5BB8A6');
    const current = store.readCompany(client.id);
    store.saveCompany({ ...current, subdomains: [...current.subdomains, { id: 'uploads', name: 'Uploads', description: '', folders: [], links: [] }] });
    writeFileSync(join(paths.areaDir(client.id, 'uploads'), 'Notes.md'), 'Mine');
    store.ensureAreaFolders(store.readCompany(client.id));
    expect(readFileSync(join(paths.areaDir(client.id, 'uploads'), 'Notes.md'), 'utf8')).toBe('Mine');
    expect(existsSync(join(paths.areaDir(client.id, 'uploads'), 'Instructions.md'))).toBe(true);
  });

  it('creates a document inside an area, and nowhere else', () => {
    const paths = dataPaths(join(dir, 'home'));
    const store = new Store(paths);
    const client = store.createCompany('Client', '#5BB8A6');
    const area = store.createArea(client.id, 'Reports');
    const company = store.readCompany(client.id);
    expect(createDocument(paths, company, `area:${area.id}`, 'Report')).toBe(join(paths.areaDir(client.id, 'reports'), 'Report.md'));
    expect(() => createDocument(paths, company, 'area:other', 'Report')).toThrow('Choose where to save this document.');
  });

  it('uses a copy of the code unless the task says otherwise', () => {
    const store = new Store(dataPaths(join(dir, 'home')));
    const client = store.createCompany('Client', '#5BB8A6');
    expect(store.createTask({ companyId: client.id, title: 'Own copy' }).isolated).toBe(true);
    expect(store.createTask({ companyId: client.id, title: 'No copy', isolated: false }).isolated).toBe(false);
  });

  it('creates private area files, lists them, and removes them with the area', () => {
    const paths = dataPaths(join(dir, 'home'));
    const store = new Store(paths);
    const client = store.createCompany('Client', '#5BB8A6');
    const area = store.createArea(client.id, 'Reports');
    const folder = paths.areaDir(client.id, 'reports');
    const repo = { id: 'api', name: 'api', path: '/api', subdomainId: area.id };
    store.saveCompany({ ...store.readCompany(client.id), projects: [repo] });
    expect(statSync(join(folder, 'Instructions.md')).mode & 0o777).toBe(0o600);
    const files = listClientFiles(paths, store.readCompany(client.id)).filter((file) => file.scope === 'areas' && file.folder === folder);
    expect(files.map((file) => file.name).sort()).toEqual(['Instructions.md', 'Notes.md', 'Tips.md']);
    const task = store.createTask({ companyId: client.id, title: 'Report', subdomainId: area.id });
    store.deleteArea(client.id, area.id);
    expect(existsSync(folder)).toBe(false);
    expect(store.findTask(task.id).subdomainId).toBe(store.readCompany(client.id).defaultAreaId);
    expect(store.readCompany(client.id).projects[0]?.subdomainId).toBeUndefined();
  });

  it('gives the agent the checklist, the area, its links and who commits', () => {
    const client = company({
      links: [{ id: 'l', label: 'Slack', url: 'https://acme.slack.com' }],
      gitIdentity: { name: 'Dev', email: 'dev@acme.dev', githubUser: 'dev-acme', folder: '~/acme/' },
    });
    const prompt = buildSystemPrompt({
      company: client,
      task: makeTask({ checklist: [{ id: '1', text: 'Read the summary', done: true }, { id: '2', text: 'Send it', done: false }] }),
      repositories: [],
      area: { id: 'p', name: 'Reports', description: 'Write reports', folders: [], links: [{ id: 'g', label: 'Guide', url: 'https://acme.dev/g' }] },
      areaFolder: '/private/p',
      companyInstructions: '',
      knowledgeDirs: [],
      notesFile: '/n.md',
      notes: '',
    });
    expect(prompt).toContain('- [x] Read the summary');
    expect(prompt).toContain('- [ ] Send it');
    expect(prompt).toContain('This task belongs to the area "Reports" of this client.');
    expect(prompt).toContain('/private/p');
    expect(prompt).toContain('- Slack: https://acme.slack.com');
    expect(prompt).toContain('- Guide: https://acme.dev/g');
    expect(prompt).toContain('Dev <dev@acme.dev>');
    expect(prompt).toContain('dev-acme');
  });
});

describe('links', () => {
  it('accepts only web addresses', () => {
    const link = (url: string) => clientLinkSchema.safeParse({ id: 'l', label: 'x', url }).success;
    expect(link('https://acme.slack.com')).toBe(true);
    expect(link('http://staging.internal:8080')).toBe(true);
    expect(link('javascript:alert(1)')).toBe(false);
    expect(link('file:///etc/passwd')).toBe(false);
    expect(link('not a link')).toBe(false);
  });

  function Editor() {
    const [links, setLinks] = useState<ClientLink[]>([]);
    return <LinksEditor links={links} suggestions={['Slack', 'Jira']} onChange={setLinks} />;
  }

  it('adds from a suggestion, completes the address, and removes', async () => {
    render(<Editor />);
    await userEvent.click(screen.getByRole('button', { name: 'Slack' }));
    await userEvent.type(screen.getByLabelText('Link address'), 'acme.slack.com');
    await userEvent.click(screen.getByRole('button', { name: 'Add link' }));
    expect(screen.getByText('https://acme.slack.com')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Suggested links' })?.textContent).toBe('Jira');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Slack' }));
    expect(screen.queryByText('https://acme.slack.com')).toBeNull();
  });

  it('explains an address it cannot use', async () => {
    render(<Editor />);
    await userEvent.type(screen.getByLabelText('Link name'), 'Bad');
    await userEvent.type(screen.getByLabelText('Link address'), 'javascript:alert(1)');
    await userEvent.click(screen.getByRole('button', { name: 'Add link' }));
    expect(screen.getByText('Write a web address, starting with https://.')).toBeTruthy();
  });
});

describe('commit identity by folder', () => {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const identity = { name: 'Acme Dev', email: 'dev@acme.dev', githubUser: 'dev-acme', folder: '~/clients/acme' };
  const makeRepo = (folder: string) => {
    mkdirSync(folder, { recursive: true });
    git(folder, 'init', '-q', '-b', 'main');
    return folder;
  };
  const backups = () => join(dir, 'home', 'backups');
  it('shows what it will write without writing it', async () => {
    const preview = await previewGitIdentity(company(), identity, PATH);
    expect(preview.addsRule).toBe(true);
    expect(preview.preview).toContain('[includeIf "gitdir:~/clients/acme/"]');
    expect(preview.preview).toContain('~/.gitconfig.d/hatstand-c');
    expect(preview.preview).toContain('email = dev@acme.dev');
    expect(existsSync(join(dir, '.gitconfig'))).toBe(false);
    expect(existsSync(join(dir, '.gitconfig.d'))).toBe(false);
  });

  it('applies to repositories and task copies in the folder, and nowhere else', async () => {
    writeFileSync(join(dir, '.gitconfig'), '[user]\n\tname = Personal\n\temail = me@personal.dev\n[alias]\n\tst = status\n');
    const repo = makeRepo(join(dir, 'clients', 'acme', 'api'));
    const other = makeRepo(join(dir, 'elsewhere'));
    git(repo, '-c', 'user.name=T', '-c', 'user.email=t@e.dev', 'commit', '-q', '--allow-empty', '-m', 'first');
    const copy = join(dir, 'worktrees', 'task');
    git(repo, 'worktree', 'add', '-q', '-b', 'task', copy);
    const client = company({ projects: [{ id: 'api', name: 'api', path: repo }, { id: 'other', name: 'other', path: other }] });

    const saved = await applyGitIdentity(client, identity, PATH, backups());

    expect(git(repo, 'config', 'user.email')).toBe('dev@acme.dev');
    expect(git(copy, 'config', 'user.email')).toBe('dev@acme.dev');
    expect(git(repo, 'config', 'github.user')).toBe('dev-acme');
    expect(git(other, 'config', 'user.email')).toBe('me@personal.dev');
    expect(git(dir, 'config', '--global', 'alias.st')).toBe('status');
    expect(saved.gitIdentity?.appliedAt).toBeTruthy();

    const { repos } = await gitIdentityStatus(saved, PATH);
    expect(repos.find((item) => item.name === 'api')).toMatchObject({ covered: true, matches: true });
    expect(repos.find((item) => item.name === 'other')).toMatchObject({ covered: false, matches: false, email: 'me@personal.dev' });
  });

  it('saves a private copy of the config before changing it', async () => {
    const original = '[alias]\n\tst = status\n';
    writeFileSync(join(dir, '.gitconfig'), original);
    await applyGitIdentity(company(), identity, PATH, backups());
    const [backup] = execFileSync('ls', [backups()], { encoding: 'utf8' }).trim().split('\n');
    expect(readFileSync(join(backups(), backup ?? ''), 'utf8')).toBe(original);
    expect(statSync(join(backups(), backup ?? '')).mode & 0o777).toBe(0o600);
  });

  it('adds one rule when applied twice, and updates the values', async () => {
    await applyGitIdentity(company(), identity, PATH, backups());
    await applyGitIdentity(company(), { ...identity, email: 'new@acme.dev', githubUser: '' }, PATH, backups());
    expect(git(dir, 'config', '--global', '--get-all', 'includeIf.gitdir:~/clients/acme/.path')).toBe('~/.gitconfig.d/hatstand-c');
    const file = join(dir, '.gitconfig.d', 'hatstand-c');
    expect(git(dir, 'config', '--file', file, 'user.email')).toBe('new@acme.dev');
    expect(readFileSync(file, 'utf8')).not.toContain('github');
  });

  it('writes values that look like config safely', async () => {
    const repo = makeRepo(join(dir, 'clients', 'acme', 'api'));
    await applyGitIdentity(company(), { ...identity, name: 'Dev "x" ; [core]' }, PATH, backups());
    expect(git(repo, 'config', 'user.name')).toBe('Dev "x" ; [core]');
    expect(git(dir, 'config', '--file', join(dir, '.gitconfig.d', 'hatstand-c'), '--name-only', '--list').split('\n').sort()).toEqual(['github.user', 'user.email', 'user.name']);
  });

  describe('when the folder already has a rule of yours', () => {
    const yours = () => {
      mkdirSync(join(dir, '.gitconfig.d'));
      writeFileSync(join(dir, '.gitconfig.d', 'mine'), '[user]\n\tname = Mine\n\temail = mine@acme.dev\n[url "git@github-acme:acme/"]\n\tinsteadOf = https://github.com/acme/\n');
      writeFileSync(join(dir, '.gitconfig'), '[includeIf "gitdir:~/clients/acme/"]\n\tpath = ~/.gitconfig.d/mine\n');
    };

    it('finds it and suggests what it uses', async () => {
      yours();
      const repo = makeRepo(join(dir, 'clients', 'acme', 'api'));
      const { suggested } = await gitIdentityStatus(company({ projects: [{ id: 'api', name: 'api', path: repo }] }), PATH);
      expect(suggested).toMatchObject({ name: 'Mine', email: 'mine@acme.dev', folder: '~/clients/acme/' });
    });

    it('leaves your files alone when the identity matches', async () => {
      yours();
      const before = readFileSync(join(dir, '.gitconfig'), 'utf8');
      const mine = readFileSync(join(dir, '.gitconfig.d', 'mine'), 'utf8');
      const repo = makeRepo(join(dir, 'clients', 'acme', 'api'));
      const client = company({ projects: [{ id: 'api', name: 'api', path: repo }] });
      const input = { ...identity, name: 'Mine', email: 'mine@acme.dev' };
      expect((await previewGitIdentity(client, input, PATH)).existingFile).toBe('~/.gitconfig.d/mine');
      const saved = await applyGitIdentity(client, input, PATH, backups());
      expect(saved.gitIdentity?.appliedAt).toBeTruthy();
      expect(readFileSync(join(dir, '.gitconfig'), 'utf8')).toBe(before);
      expect(readFileSync(join(dir, '.gitconfig.d', 'mine'), 'utf8')).toBe(mine);
      expect(existsSync(join(dir, '.gitconfig.d', 'hatstand-c'))).toBe(false);
    });

    it('refuses, and explains, when your rule commits as someone else', async () => {
      yours();
      const repo = makeRepo(join(dir, 'clients', 'acme', 'api'));
      const client = company({ projects: [{ id: 'api', name: 'api', path: repo }] });
      await expect(applyGitIdentity(client, identity, PATH, backups())).rejects.toThrow('already uses ~/.gitconfig.d/mine');
    });
  });

  it('gives agents the identity, and nothing when there is none', () => {
    expect(identityEnv(undefined)).toEqual({});
    expect(identityEnv({ ...identity })).toEqual({ GIT_AUTHOR_NAME: 'Acme Dev', GIT_AUTHOR_EMAIL: 'dev@acme.dev', GIT_COMMITTER_NAME: 'Acme Dev', GIT_COMMITTER_EMAIL: 'dev@acme.dev' });
  });
});
