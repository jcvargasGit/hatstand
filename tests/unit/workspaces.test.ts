import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseCopilotConfig } from '../../src/main/agent-status';
import { githubCopilot } from '../../src/main/agents/github-copilot';
import { hideSecrets, sessionGitEnv } from '../../src/main/git-credentials';
import { buildInitialPrompt, buildSystemPrompt } from '../../src/main/agents/task-prompt';
import { buildFingerprints, guardRepos } from '../../src/main/guard/service';
import { dataPaths } from '../../src/main/paths';
import { planningConflict, suggestPlanningPlaces } from '../../src/main/planning';
import { detectRepoLayout, listFolders } from '../../src/main/repo-layout';
import { resolveAccount } from '../../src/main/sessions';
import { Store } from '../../src/main/store';
import { taskFocus, taskFolderPaths, taskRepositories } from '../../src/main/task-folders';
import { assignFolder, assignFolderToNewSubdomain, assignWholeRepo, folderOwner, removeRepo, splitRepo } from '../../src/renderer/src/lib/repo-folders';
import { wheelSensitivity } from '../../src/renderer/src/lib/terminal-scroll';
import { accountsForClient } from '../../src/shared/accounts';
import { companySchema, subdomainFolderSchema, taskSchema, type Account, type Company } from '../../src/shared/schemas';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hatstand-workspaces-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const folders = (...paths: string[]) => paths.forEach((path) => mkdirSync(join(dir, path), { recursive: true }));

const mono = (): Company =>
  companySchema.parse({
    id: 'acme',
    name: 'Acme',
    color: '#112233',
    rootDir: '/code/mono',
    projects: [
      { id: 'mono', name: 'mono', path: '/code/mono', splitByFolder: true },
      { id: 'web', name: 'web', path: '/code/web' },
    ],
    subdomains: [
      { id: 'uploads', name: 'Uploads', folders: [{ projectId: 'mono', path: 'apps/uploads' }, { projectId: 'mono', path: 'libs/media' }] },
      { id: 'portal', name: 'Portal', folders: [{ projectId: 'mono', path: 'apps/portal' }] },
    ],
  });

const task = (change: object = {}) =>
  taskSchema.parse({ id: 't', companyId: 'acme', title: 'Retry', status: 'todo', createdAt: 'x', updatedAt: 'x', ...change });

describe('detecting a monorepo', () => {
  it('reads a pnpm workspace and ignores exclusions', () => {
    folders('apps/a', 'apps/b', 'libs/c', 'apps/node_modules');
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n  - 'libs/c'\n  - '!apps/b'\n");
    expect(detectRepoLayout(dir)).toEqual({ tool: 'pnpm workspace', isMonorepo: true, folders: ['apps/a', 'apps/b', 'libs/c'] });
  });

  it('reads both forms of package.json workspaces', () => {
    folders('packages/a');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
    expect(detectRepoLayout(dir).folders).toEqual(['packages/a']);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: { packages: ['packages/*'] } }));
    expect(detectRepoLayout(dir).tool).toBe('npm or Yarn workspaces');
  });

  it('reads Go and Cargo workspaces', () => {
    folders('svc/a', 'svc/b');
    writeFileSync(join(dir, 'go.work'), 'go 1.24\n\nuse (\n  ./svc/a\n  ./svc/b // main\n)\n');
    expect(detectRepoLayout(dir)).toMatchObject({ tool: 'Go workspace', folders: ['svc/a', 'svc/b'] });
    rmSync(join(dir, 'go.work'));
    writeFileSync(join(dir, 'Cargo.toml'), '[workspace]\nmembers = ["svc/*"]\n\n[profile.release]\nlto = true\n');
    expect(detectRepoLayout(dir)).toMatchObject({ tool: 'Cargo workspace', folders: ['svc/a', 'svc/b'] });
  });

  it('recognizes usual folders with no manifest, and a tool marker', () => {
    folders('services/a', 'services/b');
    expect(detectRepoLayout(dir)).toEqual({ tool: null, isMonorepo: true, folders: ['services/a', 'services/b'] });
    writeFileSync(join(dir, 'turbo.json'), '{}');
    expect(detectRepoLayout(dir).tool).toBe('Turborepo');
  });

  it('calls an ordinary repository what it is, and still offers its folders', () => {
    folders('src', 'docs', '.github', 'node_modules/x');
    expect(detectRepoLayout(dir)).toEqual({ tool: null, isMonorepo: false, folders: ['docs', 'src'] });
  });

  it('does not leave the repository through a workspace pattern', () => {
    folders('repo/apps/a', 'outside');
    writeFileSync(join(dir, 'repo', 'pnpm-workspace.yaml'), "packages:\n  - '../outside'\n  - 'apps/*'\n");
    expect(detectRepoLayout(join(dir, 'repo')).folders).toEqual(['apps/a']);
    expect(subdomainFolderSchema.safeParse({ projectId: 'p', path: '../outside' }).success).toBe(false);
    expect(subdomainFolderSchema.safeParse({ projectId: 'p', path: '/etc' }).success).toBe(false);
  });
});

describe('a subdomain that owns folders', () => {
  it('makes the task focus on those folders, with the repository in reach', () => {
    const company = mono();
    const value = task({ subdomainId: 'uploads' });
    expect(taskRepositories(company, value).map((repo) => repo.id)).toEqual(['mono']);
    expect(taskFolderPaths(company, value)).toEqual(['/code/mono/apps/uploads', '/code/mono/libs/media']);
    expect(taskFocus(company, value)).toEqual(['mono/apps/uploads', 'mono/libs/media']);
    expect(buildInitialPrompt(value, taskFocus(company, value))).toContain('Focus on mono/apps/uploads, mono/libs/media.');
  });

  it('adds other chosen repositories, and changes nothing without folders', () => {
    const company = mono();
    expect(taskFocus(company, task({ subdomainId: 'portal', projectIds: ['web'] }))).toEqual(['web', 'mono/apps/portal']);
    expect(taskFocus(company, task({ projectIds: ['web'] }))).toEqual(['web']);
    expect(taskFolderPaths(company, task())).toEqual([]);
  });

  it('moves a folder between subdomains, and forgets a repository cleanly', () => {
    const company = assignFolder(mono(), 'mono', 'libs/media', 'portal');
    expect(folderOwner(company, 'mono', 'libs/media')).toBe('portal');
    expect(company.subdomains[0]?.folders).toEqual([{ projectId: 'mono', path: 'apps/uploads' }]);
    expect(folderOwner(assignFolder(company, 'mono', 'libs/media', ''), 'mono', 'libs/media')).toBe('');
    expect(removeRepo(company, 'mono').subdomains.flatMap((subdomain) => subdomain.folders)).toEqual([]);
  });

  it('creates a subdomain from a folder', () => {
    const company = assignFolderToNewSubdomain(mono(), 'mono', 'apps/search', { id: 'new', name: 'search' });
    expect(company.subdomains.at(-1)).toEqual({ id: 'new', name: 'search', description: '', folders: [{ projectId: 'mono', path: 'apps/search' }], links: [] });
  });

  it('switches a repository between whole and split', () => {
    const split = splitRepo({ ...mono(), projects: [{ id: 'mono', name: 'mono', path: '/m', subdomainId: 'uploads' }] }, 'mono');
    expect(split.projects[0]).toMatchObject({ splitByFolder: true, subdomainId: undefined });
    const whole = assignWholeRepo(split, 'mono', 'portal');
    expect(whole.projects[0]).toMatchObject({ splitByFolder: undefined, subdomainId: 'portal' });
    expect(whole.subdomains.flatMap((subdomain) => subdomain.folders)).toEqual([]);
  });
});

describe('a planning repository', () => {
  it('suggests where things go from its folders', () => {
    folders('backlog/pending', 'backlog/done', 'docs/notes/adr', 'PR-reviews/api', 'other');
    expect(suggestPlanningPlaces(listFolders(dir))).toEqual([
      { name: 'Tickets', folder: 'backlog/pending' },
      { name: 'Decisions', folder: 'docs/notes/adr' },
      { name: 'Reviews', folder: 'PR-reviews' },
    ]);
    expect(suggestPlanningPlaces(['src', 'lib'])).toEqual([]);
  });

  it('refuses a folder that would conflict', () => {
    folders('specs/.git', 'home/data', 'specs/notes');
    const base = { ...mono(), projects: [{ id: 'specs', name: 'specs', path: join(dir, 'specs') }] };
    expect(planningConflict(mono(), join(dir, 'missing'), join(dir, 'home'))).toMatch(/does not exist/);
    expect(planningConflict(mono(), join(dir, 'home/data'), join(dir, 'home'))).toMatch(/data folder/);
    expect(planningConflict(base, join(dir, 'specs'), join(dir, 'home'))).toBeNull();
    const withKnowledge = { ...mono(), context: { ...mono().context, knowledgeDir: join(dir, 'specs/notes') } };
    expect(planningConflict(withKnowledge, join(dir, 'specs'), join(dir, 'home'))).toMatch(/overlaps/);
    expect(planningConflict(mono(), join(dir, 'specs'), join(dir, 'home'))).toBeNull();
  });

  it('needs git, and accepts a folder inside a repository', () => {
    folders('plain', 'specs/.git', 'specs/docs');
    expect(planningConflict(mono(), join(dir, 'plain'), join(dir, 'home'))).toMatch(/not a git repository/);
    expect(planningConflict(mono(), join(dir, 'specs'), join(dir, 'home'))).toBeNull();
    expect(planningConflict(mono(), join(dir, 'specs/docs'), join(dir, 'home'))).toBeNull();
  });

  it('is told to the agent, without permission to commit', () => {
    const company = { ...mono(), planning: { path: '/specs', places: [{ name: 'Tickets', folder: 'backlog/pending' }] } };
    const prompt = buildSystemPrompt({ company, task: task(), repositories: [], companyInstructions: '', knowledgeDirs: [], planning: { ...company.planning, hasGit: true }, notesFile: '/tasks/t.md', notes: '' });
    expect(prompt).toContain('/tasks/t.<short-name>.md');
    expect(prompt).toContain('live in /specs');
    expect(prompt).toContain('- Tickets: backlog/pending');
    expect(prompt).toContain('Do not commit, push or open a pull request in this repository unless the person asks.');
    expect(buildSystemPrompt({ company: mono(), task: task(), repositories: [], companyInstructions: '', knowledgeDirs: [], notesFile: '/n', notes: '' })).not.toContain('Planning repository');
  });

  it('never counts as protected knowledge, and still gets the commit check', () => {
    const paths = dataPaths(join(dir, 'home'));
    folders('specs/team');
    const line = 'A line of team planning that is long enough to be fingerprinted by the guard.';
    writeFileSync(join(dir, 'specs/team/plan.md'), `${line}\n`);
    const planning = { path: join(dir, 'specs'), places: [] };
    const company = { ...mono(), projects: [], planning, context: { ...mono().context, knowledgeDir: join(dir, 'specs/team') } };
    expect(buildFingerprints(paths, company, {}).lineHashes).toEqual([]);
    const without = { ...company, planning: undefined };
    expect(buildFingerprints(paths, without, {}).lineHashes.length).toBeGreaterThan(0);
    expect(guardRepos(company)).toEqual([]);
  });
});

describe('an account for one client', () => {
  const shared: Account = { id: 'shared', name: 'Shared', type: 'claude-code', label: 'personal' };
  const own: Account = { ...shared, id: 'own', name: 'Own', label: 'company', companyId: 'acme' };
  const others: Account = { ...shared, id: 'others', name: 'Theirs', companyId: 'other' };
  const all = [others, shared, own];

  it('is offered only to that client', () => {
    expect(accountsForClient(all, 'acme').map((account) => account.id)).toEqual(['shared', 'own']);
    expect(accountsForClient(all, 'third').map((account) => account.id)).toEqual(['shared']);
  });

  it('never runs a session of another client', () => {
    expect(resolveAccount(all, 'shared', mono(), task({ accountId: 'others' })).id).toBe('shared');
    expect(resolveAccount(all, 'others', { ...mono(), defaultAccountId: 'others' }, task()).id).toBe('shared');
    expect(resolveAccount(all, 'shared', { ...mono(), defaultAccountId: 'own' }, task()).id).toBe('own');
  });

  it('cannot replace the last shared account or the general default', () => {
    const store = new Store(dataPaths(join(dir, 'home')));
    const [first] = store.readAccounts().accounts;
    store.saveAccount({ ...own });
    expect(() => store.setDefaultAccount('own')).toThrow(/one client/);
    expect(() => store.removeAccount(first?.id ?? '')).toThrow(/every client/);
    store.removeAccountsOfCompany('acme');
    expect(store.readAccounts().accounts.map((account) => account.id)).toEqual([first?.id]);
  });
});

describe('wheel speed in the terminal', () => {
  it('undoes the trackpad slowdown only when the app receives the wheel', () => {
    expect(wheelSensitivity(8, true) * 0.3).toBeCloseTo(1);
    expect(wheelSensitivity(-49, true) * 0.3).toBeCloseTo(1);
    expect(wheelSensitivity(50, true)).toBe(1);
    expect(wheelSensitivity(8, false)).toBe(1);
  });
});

describe('GitHub Copilot sessions', () => {
  const account: Account = { id: 'c', name: 'Work', type: 'github-copilot', label: 'company' };
  const input = { account, company: mono(), task: task(), sessionId: 's', sessionDir: '/run/s', notesFile: '/notes/t.md', resume: false, promptFile: '/p', settingsFile: '/f', addDirs: ['/k'] };
  const hooks = () => z.object({ hooks: z.record(z.string(), z.array(z.object({ bash: z.string() }))) }).parse(JSON.parse(githubCopilot.buildStatusSettings())).hooks;
  const runHook = (bash: string, stdin: object) => {
    const statusFile = join(dir, 'status');
    writeFileSync(statusFile, 'before');
    const result = spawnSync('sh', ['-c', bash], { input: JSON.stringify(stdin), env: { PATH: process.env.PATH, HATSTAND_STATUS_FILE: statusFile }, encoding: 'utf8' });
    return { output: result.stdout, status: readFileSync(statusFile, 'utf8') };
  };

  it('starts or resumes the same session, with its hooks and instructions', () => {
    const fresh = githubCopilot.buildLaunch(input);
    expect(fresh.command).toBe('copilot');
    expect(fresh.args.slice(0, 2)).toEqual(['--session-id', 's']);
    expect(fresh.args).toEqual(expect.arrayContaining(['--plugin-dir', '/run/s/plugin', '--add-dir', '/k']));
    expect(fresh.args).toContain('--allow-tool=write(/notes/t.md)');
    expect(fresh.env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS).toBe('/run/s/instructions');
    expect(fresh.env.COPILOT_HOME).toBeUndefined();
    expect(githubCopilot.buildLaunch({ ...input, resume: true }).args.slice(0, 2)).toEqual(['--resume', 's']);
  });

  it('uses the account sign-in folder and model, and asks permission unless told not to', () => {
    const launch = githubCopilot.buildLaunch({ ...input, account: { ...account, configDir: '/login', model: 'gpt-x' } });
    expect(launch.env.COPILOT_HOME).toBe('/login');
    expect(launch.args).toEqual(expect.arrayContaining(['--model', 'gpt-x']));
    expect(launch.args).not.toContain('--allow-all');
    expect(githubCopilot.buildLaunch({ ...input, company: { ...mono(), skipPermissions: true } }).args).toContain('--allow-all');
  });

  it('writes the prompt where Copilot loads it for every file', () => {
    const promptFile = join(dir, 'prompt.md');
    const settingsFile = join(dir, 'settings.json');
    writeFileSync(promptFile, '# Rules\n');
    writeFileSync(settingsFile, githubCopilot.buildStatusSettings());
    githubCopilot.prepareSession?.({ sessionDir: join(dir, 'run'), promptFile, settingsFile });
    expect(readFileSync(join(dir, 'run/instructions/hatstand.instructions.md'), 'utf8')).toBe('---\napplyTo: "**"\n---\n# Rules\n');
    expect(readFileSync(join(dir, 'run/plugin/hooks.json'), 'utf8')).toBe(githubCopilot.buildStatusSettings());
  });

  it('reports a permission question, but not other notifications', () => {
    const [notification] = hooks().notification ?? [];
    expect(runHook(notification?.bash ?? '', { notification_type: 'permission_prompt' }).status).toBe('needs-input');
    expect(runHook(notification?.bash ?? '', { notification_type: 'agent_completed' }).status).toBe('before');
  });

  it('reports working, a question to you, and the end of a turn', () => {
    const before = hooks().preToolUse?.[1]?.bash ?? '';
    expect(runHook(before, { toolName: 'bash' }).status).toBe('working');
    expect(runHook(before, { toolName: 'ask_user' }).status).toBe('needs-input');
    expect(runHook(hooks().postToolUse?.[0]?.bash ?? '', { toolName: 'ask_user' }).status).toBe('working');
    expect(runHook(hooks().agentStop?.[0]?.bash ?? '', {}).status).toBe('idle');
  });

  it('denies a command that skips git hooks, and nothing else', () => {
    const block = hooks().preToolUse?.[0]?.bash ?? '';
    expect(JSON.parse(runHook(block, { toolName: 'bash', toolArgs: { command: 'git commit --no-verify -m x' } }).output)).toMatchObject({ permissionDecision: 'deny' });
    expect(runHook(block, { toolName: 'bash', toolArgs: { command: 'git commit -m x' } }).output).toBe('');
    expect(runHook(block, { toolName: 'edit', toolArgs: { text: 'docs about --no-verify' } }).output).toBe('');
  });

  it('keeps client GitHub tokens from becoming the Copilot login, while git still uses them', () => {
    const secrets = { GITHUB_TOKEN: 't1', GH_TOKEN: 't2', JIRA_API_TOKEN: 'j' };
    const hidden = githubCopilot.hiddenSecrets ?? [];
    expect(hideSecrets(secrets, hidden)).toEqual({ HATSTAND_GITHUB_TOKEN: 't1', HATSTAND_GH_TOKEN: 't2', JIRA_API_TOKEN: 'j' });
    const source = { provider: 'github' as const, owner: 'acme' };
    const env = sessionGitEnv(source, secrets, hidden);
    expect(env.GIT_CONFIG_VALUE_1).toContain('HATSTAND_GITHUB_TOKEN');
    expect(sessionGitEnv(source, secrets).GIT_CONFIG_VALUE_1).not.toContain('HATSTAND_');
  });

  it('reads who is signed in without needing a session', () => {
    expect(parseCopilotConfig('// comment\n{"loggedInUsers":[{"host":"h","login":"me"}],"lastLoggedInUser":{"login":"me"}}')).toEqual({ signedIn: true, email: 'me' });
    expect(parseCopilotConfig('{"loggedInUsers":[]}').signedIn).toBe(false);
    expect(parseCopilotConfig('{}').signedIn).toBe(false);
    expect(parseCopilotConfig('not json').signedIn).toBe(false);
  });
});
