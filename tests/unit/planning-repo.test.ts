import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { suggestPlanningPlaces } from '../../src/main/planning';
import { createPlanningRepo, defaultPlanningFolder } from '../../src/main/planning-repo';
import { listFolders } from '../../src/main/repo-layout';
import { companySchema, type Company } from '../../src/shared/schemas';

const PATH = process.env.PATH ?? '';
let dir: string;
let dataHome: string;
let code: string;

const client = (change: Partial<Company> = {}): Company => ({
  ...companySchema.parse({ id: 'acme', name: 'Acme', color: '#E8A33D' }),
  ...change,
});

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function useGlobalConfig(text: string): void {
  const file = join(dir, 'global-gitconfig');
  writeFileSync(file, text);
  vi.stubEnv('GIT_CONFIG_GLOBAL', file);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-planning-repo-')));
  dataHome = join(dir, 'home');
  code = join(dir, 'code');
  mkdirSync(dataHome);
  mkdirSync(code);
  writeFileSync(join(dir, 'acme-identity'), '[user]\n  name = Alice Acme\n  email = alice@acme.test\n');
  useGlobalConfig(`[includeIf "gitdir:${code}/"]\n  path = ${join(dir, 'acme-identity')}\n`);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('creating a planning repository', () => {
  it('makes a repository on main with one commit, a clean status and no remote', async () => {
    const target = join(code, 'acme-planning');
    expect(await createPlanningRepo(client(), target, dataHome, PATH)).toBe(target);
    expect(git(target, 'branch', '--show-current')).toBe('main');
    expect(git(target, 'rev-list', '--count', 'HEAD')).toBe('1');
    expect(git(target, 'status', '--porcelain')).toBe('');
    expect(git(target, 'remote')).toBe('');
  });

  it('writes the agreed structure, and its places fill in by themselves', async () => {
    const target = join(code, 'acme-planning');
    await createPlanningRepo(client(), target, dataHome, PATH);
    expect(git(target, 'ls-files').split('\n').sort()).toEqual(['README.md', 'decisions/.gitkeep', 'specs/.gitkeep', 'templates/decision.md', 'templates/spec.md']);
    expect(suggestPlanningPlaces(listFolders(target))).toEqual([
      { name: 'Decisions', folder: 'decisions' },
      { name: 'Specs', folder: 'specs' },
    ]);
  });

  it('commits with the email of the folder, and writes no identity into the repository', async () => {
    const target = join(code, 'acme-planning');
    await createPlanningRepo(client(), target, dataHome, PATH);
    expect(git(target, 'log', '-1', '--format=%ae %ce')).toBe('alice@acme.test alice@acme.test');
    expect(() => git(target, 'config', '--local', 'user.email')).toThrow();
  });

  it('accepts an empty folder, and creates missing parent folders', async () => {
    const empty = join(code, 'empty');
    mkdirSync(empty);
    await createPlanningRepo(client(), empty, dataHome, PATH);
    expect(existsSync(join(empty, '.git'))).toBe(true);
    const nested = join(code, 'new', 'deep', 'plans');
    await createPlanningRepo(client(), nested, dataHome, PATH);
    expect(existsSync(join(nested, '.git'))).toBe(true);
  });

  it('expands ~ and refuses a relative path', async () => {
    await createPlanningRepo(client(), '~/plans', dataHome, PATH, code);
    expect(existsSync(join(code, 'plans', '.git'))).toBe(true);
    await expect(createPlanningRepo(client(), 'plans', dataHome, PATH)).rejects.toThrow(/full path/);
  });

  it('refuses a folder that already has files, a file, and a folder inside a repository', async () => {
    const full = join(code, 'full');
    mkdirSync(full);
    writeFileSync(join(full, 'notes.md'), 'mine');
    await expect(createPlanningRepo(client(), full, dataHome, PATH)).rejects.toThrow(/already has files/);
    expect(readdirSync(full)).toEqual(['notes.md']);

    await expect(createPlanningRepo(client(), join(full, 'notes.md'), dataHome, PATH)).rejects.toThrow(/is a file/);

    const repo = join(code, 'repo');
    mkdirSync(repo);
    git(repo, 'init', '-q');
    await expect(createPlanningRepo(client(), join(repo, 'plans'), dataHome, PATH)).rejects.toThrow(/inside the git repository/);
    expect(readdirSync(repo)).toEqual(['.git']);
  });

  it('refuses the data folder, and anything overlapping knowledge or skills', async () => {
    await expect(createPlanningRepo(client(), join(dataHome, 'plans'), dataHome, PATH)).rejects.toThrow(/data folder/);
    const knowledge = join(code, 'knowledge');
    const withKnowledge = companySchema.parse({ id: 'acme', name: 'Acme', color: '#E8A33D', context: { knowledgeDir: knowledge } });
    await expect(createPlanningRepo(withKnowledge, join(knowledge, 'plans'), dataHome, PATH)).rejects.toThrow(/overlaps/);
  });

  it('stops before committing when the folder has no email, and leaves nothing behind', async () => {
    const outside = join(dir, 'outside');
    mkdirSync(outside);
    await expect(createPlanningRepo(client(), join(outside, 'plans'), dataHome, PATH)).rejects.toThrow(/no commit email/);
    expect(readdirSync(outside)).toEqual([]);
    await expect(createPlanningRepo(client(), join(dir, 'new-parent', 'deep', 'plans'), dataHome, PATH)).rejects.toThrow(/no commit email/);
    expect(existsSync(join(dir, 'new-parent'))).toBe(false);
  });

  it('shows the error of a failing commit hook, and keeps an empty folder chosen by the person', async () => {
    const templates = join(dir, 'git-template');
    mkdirSync(join(templates, 'hooks'), { recursive: true });
    writeFileSync(join(templates, 'hooks', 'pre-commit'), '#!/bin/sh\necho "blocked by hook" >&2\nexit 1\n');
    chmodSync(join(templates, 'hooks', 'pre-commit'), 0o755);
    useGlobalConfig(`[init]\n  templateDir = ${templates}\n[user]\n  name = Alice\n  email = alice@acme.test\n`);
    const empty = join(code, 'empty');
    mkdirSync(empty);
    await expect(createPlanningRepo(client(), empty, dataHome, PATH)).rejects.toThrow(/blocked by hook/);
    expect(readdirSync(code)).toEqual(['empty']);
    expect(readdirSync(empty)).toEqual([]);
  });
});

describe('the default folder', () => {
  const home = '/Users/alice';

  it('goes next to a single repository, not inside it', () => {
    const repo = join(code, 'api');
    mkdirSync(join(repo, '.git'), { recursive: true });
    expect(defaultPlanningFolder({ id: 'acme', projects: [{ id: 'a', name: 'api', path: repo }] }, home)).toBe(join(code, 'acme-planning'));
  });

  it('goes in the shared parent of several repositories', () => {
    const projects = ['api', 'web'].map((name) => ({ id: name, name, path: join(code, name) }));
    expect(defaultPlanningFolder({ id: 'acme', projects }, home)).toBe(join(code, 'acme-planning'));
  });

  it('uses the projects folder for a client with no repositories', () => {
    expect(defaultPlanningFolder({ id: 'acme', projects: [] }, home)).toBe('/Users/alice/projects/acme/acme-planning');
  });

  it('stays in the client folder when the home folder is itself a repository', () => {
    mkdirSync(join(dir, '.git'));
    expect(defaultPlanningFolder({ id: 'acme', projects: [] }, dir)).toBe(join(dir, 'projects', 'acme', 'acme-planning'));
  });
});
