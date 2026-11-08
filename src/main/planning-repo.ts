import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type { Company } from '../shared/schemas';
import { expandUserPath, findGitRoot } from './paths';
import { isInside, protectedFolderConflict } from './planning';
import { defaultClientFolder } from './task-folders';

const GIT_TIMEOUT_MS = 30_000;
const FIRST_COMMIT_MESSAGE = 'Start the planning repository';

export function defaultPlanningFolder(company: Pick<Company, 'id' | 'projects'>, home = homedir()): string {
  const folder = defaultClientFolder(company, home);
  const gitRoot = findGitRoot(folder);
  const base = gitRoot && !isInside(home, gitRoot) ? dirname(gitRoot) : folder;
  return join(base, `${company.id}-planning`);
}

export function planningScaffold(clientName: string): Record<string, string> {
  return {
    'README.md': `# Planning for ${clientName}

Specs and decisions for this client. Tickets and day-to-day work stay in Hatstand, as tasks.

## Where each thing goes

| Folder | What goes there | Start from |
|---|---|---|
| \`specs/\` | What we are going to build and why | \`templates/spec.md\` |
| \`decisions/\` | A decision that is expensive to change, and why we made it | \`templates/decision.md\` |

Add a folder when a client needs one, such as \`runbooks/\` or \`architecture/\`.

## Names

Number files in order, in lowercase with dashes: \`0001-title-with-dashes.md\`.

## Status

- A spec is \`draft\`, \`approved\`, \`done\` or \`dropped\`.
- A decision is \`proposed\`, \`accepted\`, \`rejected\`, \`deprecated\` or \`superseded by NNNN\`.

Do not delete an old decision. Change its status and link the one that replaces it.

## Backup

This repository starts on one computer, with no remote. It has no backup until you add a remote and push.
`,
    'templates/spec.md': `# Title

Status: draft

## Problem

What is wrong today, and for whom.

## Goal

What is true when this is done.

## Out of scope

What this does not cover.

## Proposal

How it will work.

## Acceptance criteria

- [ ] Something you can check.

## Open questions

- What is still undecided.
`,
    'templates/decision.md': `# Title

Status: proposed
Date: YYYY-MM-DD

## Context

What forces this decision.

## Decision

What we decided.

## Options considered

The other options, and why not.

## Consequences

What gets easier, and what gets harder.
`,
    'specs/.gitkeep': '',
    'decisions/.gitkeep': '',
  };
}

function creationConflict(company: Company, target: string, dataHome: string): string | null {
  const conflict = protectedFolderConflict(company, target, dataHome);
  if (conflict) return conflict;
  const gitRoot = findGitRoot(target);
  if (gitRoot) return `${target} is inside the git repository ${gitRoot}. Choose a folder outside any repository.`;
  if (!existsSync(target)) return null;
  if (!statSync(target).isDirectory()) return `${target} is a file. Choose a folder.`;
  return readdirSync(target).length > 0 ? `${target} already has files in it. Choose an empty folder.` : null;
}

function git(cwd: string, path: string, args: string[]): Promise<string> {
  return new Promise((done, fail) => {
    execFile('git', args, { cwd, env: { ...process.env, PATH: path }, encoding: 'utf8', timeout: GIT_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (!error) done(stdout.trim());
      else if (error.killed) fail(new Error(`Git did not finish in time on "git ${args[0]}". If your commits are signed, it may be waiting for your passphrase.`));
      else fail(new Error(stderr.trim() || error.message));
    });
  });
}

const commitEmail = (cwd: string, path: string) => git(cwd, path, ['config', 'user.email']).catch(() => '');

async function buildRepository(folder: string, target: string, clientName: string, path: string): Promise<void> {
  for (const [file, content] of Object.entries(planningScaffold(clientName))) {
    mkdirSync(dirname(join(folder, file)), { recursive: true });
    writeFileSync(join(folder, file), content);
  }
  await git(folder, path, ['init', '-q', '-b', 'main']);
  if (!(await commitEmail(folder, path))) {
    throw new Error(`Git has no commit email for ${dirname(target)}. Set one in the Commit identity step, or choose a folder that has one.`);
  }
  await git(folder, path, ['add', '-A']);
  await git(folder, path, ['commit', '-q', '-m', FIRST_COMMIT_MESSAGE]);
}

export async function createPlanningRepo(company: Company, rawPath: string, dataHome: string, path: string, home = homedir()): Promise<string> {
  const expanded = expandUserPath(rawPath, home);
  if (!isAbsolute(expanded)) throw new Error('Write the full path, starting with / or ~/. For example ~/projects/client-planning.');
  const target = resolve(expanded);
  const conflict = creationConflict(company, target, dataHome);
  if (conflict) throw new Error(conflict);

  const parent = dirname(target);
  const firstCreated = mkdirSync(parent, { recursive: true });
  const building = join(parent, `.${basename(target)}-${randomUUID()}`);
  try {
    mkdirSync(building);
    await buildRepository(building, target, company.name, path);
    if (existsSync(target)) rmdirSync(target);
    renameSync(building, target);
    return target;
  } catch (error) {
    rmSync(firstCreated ?? building, { recursive: true, force: true });
    throw error;
  }
}
