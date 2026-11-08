import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fingerprintDirs, fingerprintSecrets, type Fingerprints } from '../../src/main/guard/fingerprints';
import { buildGuardScript } from '../../src/main/guard/hook-script';
import { inspectHook, installPreCommitHook } from '../../src/main/guard/install';

const SECRET = 'tok_0123456789abcdefghij'; // gitleaks:allow
const KNOWLEDGE = [
  'Fixture knowledge line one, long enough for the commit check to count.',
  'Fixture knowledge line two, long enough for the commit check to count.',
  'Fixture knowledge line three, long enough for the commit check to count.',
  'Fixture knowledge line four, long enough for the commit check to count.',
];

let root: string;
let guardDir: string;
let guardScript: string;
let repo: string;
const previousGlobal = process.env.GIT_CONFIG_GLOBAL;

function git(...args: string[]) {
  return spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
}

function commitFile(name: string, content: string) {
  writeFileSync(join(repo, name), content);
  git('add', name);
  return git('commit', '-m', 'change');
}

beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  root = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-guard-')));
  guardDir = join(root, 'guard');
  mkdirSync(guardDir);
  guardScript = join(guardDir, 'guard.cjs');
  writeFileSync(guardScript, buildGuardScript());

  const knowledgeDir = join(root, 'knowledge');
  mkdirSync(knowledgeDir);
  writeFileSync(join(knowledgeDir, 'domain.md'), KNOWLEDGE.join('\n'));
  const fingerprints: Fingerprints = {
    company: 'Other client',
    lineHashes: fingerprintDirs([knowledgeDir]),
    secrets: fingerprintSecrets({ OTHER_API_TOKEN: SECRET, OTHER_SITE: 'public-value-here' }),
  };
  writeFileSync(join(guardDir, 'other.json'), JSON.stringify(fingerprints));
});

beforeEach(() => {
  repo = mkdtempSync(join(root, 'repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
});

afterAll(() => {
  if (previousGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = previousGlobal;
  rmSync(root, { recursive: true, force: true });
});

describe('fingerprints', () => {
  it('store no client text', () => {
    const stored = readFileSync(join(guardDir, 'other.json'), 'utf8');
    expect(stored).not.toContain(SECRET);
    expect(stored).not.toContain('Fixture knowledge');
  });

  it('only cover values that look like credentials', () => {
    const fingerprints = JSON.parse(readFileSync(join(guardDir, 'other.json'), 'utf8')) as Fingerprints;
    expect(fingerprints.secrets.map((secret) => secret.name)).toEqual(['OTHER_API_TOKEN']);
  });
});

describe('the pre-commit guard', () => {
  beforeEach(() => {
    expect(installPreCommitHook(repo, process.execPath, guardScript).installed).toBe(true);
  });

  it('allows an ordinary commit', () => {
    expect(commitFile('code.ts', 'export const answer = 42;\n').status).toBe(0);
  });

  it('blocks a key from any client, even inside a longer line', () => {
    const result = commitFile('config.ts', `const key = "${SECRET}";\n`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('OTHER_API_TOKEN');
    expect(result.stderr).not.toContain(SECRET);
  });

  it('blocks copied knowledge', () => {
    const result = commitFile('notes.md', `${KNOWLEDGE.slice(0, 3).join('\n')}\n`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Other client');
  });

  it('allows a single matching line, which can be a coincidence', () => {
    expect(commitFile('notes.md', `${KNOWLEDGE[0]}\n`).status).toBe(0);
  });

  it('can be installed twice', () => {
    expect(installPreCommitHook(repo, process.execPath, guardScript).installed).toBe(true);
  });
});

describe('installing the guard', () => {
  it('does not replace a hook that is already there', () => {
    const hook = join(repo, '.git/hooks/pre-commit');
    writeFileSync(hook, '#!/bin/sh\nexit 0\n');
    chmodSync(hook, 0o755);
    const result = installPreCommitHook(repo, process.execPath, guardScript);
    expect(result.installed).toBe(false);
    expect(readFileSync(hook, 'utf8')).toBe('#!/bin/sh\nexit 0\n');
  });

  it('does not write into a shared hooks folder', () => {
    const shared = join(root, 'shared-hooks');
    execFileSync('git', ['config', 'core.hooksPath', shared], { cwd: repo });
    const result = installPreCommitHook(repo, process.execPath, guardScript);
    expect(result.installed).toBe(false);
    expect(result.reason).toContain(shared);
  });

  it('reports the state of each repository', () => {
    const plain = mkdtempSync(join(root, 'plain-'));
    expect(inspectHook(plain).state).toBe('not-git');
    const hook = join(repo, '.git/hooks/pre-commit');
    rmSync(hook, { force: true });
    expect(inspectHook(repo).state).toBe('missing');
    writeFileSync(hook, '#!/bin/sh\nexit 0\n');
    expect(inspectHook(repo).state).toBe('existing-hook');
    rmSync(hook);
    installPreCommitHook(repo, process.execPath, guardScript);
    expect(inspectHook(repo).state).toBe('protected');
    rmSync(hook);
  });

  it('keeps an existing hook when asked, and runs it only after the check passes', () => {
    const hook = join(repo, '.git/hooks/pre-commit');
    const ran = join(root, 'previous-hook-ran');
    rmSync(hook, { force: true });
    rmSync(join(repo, '.git/hooks/before-hatstand'), { recursive: true, force: true });
    writeFileSync(hook, `#!/bin/sh\necho "$(basename "$0")" > "${ran}"\n`);
    chmodSync(hook, 0o755);

    expect(installPreCommitHook(repo, process.execPath, guardScript, true).installed).toBe(true);
    expect(installPreCommitHook(repo, process.execPath, guardScript).installed).toBe(true);

    expect(commitFile('blocked.ts', `const key = "${SECRET}";\n`).status).not.toBe(0);
    expect(existsSync(ran)).toBe(false);
    git('reset', '-q', 'blocked.ts');

    expect(commitFile('fine.ts', 'export const fine = 1;\n').status).toBe(0);
    expect(readFileSync(ran, 'utf8').trim()).toBe('pre-commit');

    rmSync(hook);
    rmSync(join(repo, '.git/hooks/before-hatstand'), { recursive: true, force: true });
  });

  it('stops the commit when the kept hook fails', () => {
    const hook = join(repo, '.git/hooks/pre-commit');
    rmSync(hook, { force: true });
    writeFileSync(hook, '#!/bin/sh\nexit 7\n');
    chmodSync(hook, 0o755);
    installPreCommitHook(repo, process.execPath, guardScript, true);
    expect(commitFile('other.ts', 'export const other = 1;\n').status).not.toBe(0);
    git('reset', '-q', 'other.ts');
    rmSync(hook);
    rmSync(join(repo, '.git/hooks/before-hatstand'), { recursive: true, force: true });
  });

  it('reports a folder that is not a repository', () => {
    const plain = mkdtempSync(join(root, 'plain-'));
    expect(installPreCommitHook(plain, process.execPath, guardScript).installed).toBe(false);
  });
});
