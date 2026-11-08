import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import type { PlaybookList, PlaybookSummary } from '../shared/api';
import { playbookSchema, type Playbook, type TaskGuide } from '../shared/schemas';
import { BUILTIN_PLAYBOOKS } from './builtin-playbooks';
import type { DataPaths } from './paths';

export function parsePlaybook(content: string): Playbook {
  let raw: unknown;
  try {
    raw = parse(content);
  } catch (error) {
    throw new Error(`This is not valid YAML. ${error instanceof Error ? error.message.split('\n')[0] : ''}`.trim());
  }
  const result = playbookSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`${issue?.path.join('.') || 'Guide'}: ${issue?.message ?? 'this guide is not valid.'}`);
  }
  return result.data;
}

export function listPlaybooks(paths: DataPaths, companyId: string): PlaybookList {
  const builtIn = (id: string, playbook: Playbook): PlaybookSummary => ({ ...playbook, id, origin: 'built-in' });
  const found = new Map(Object.entries(BUILTIN_PLAYBOOKS).map(([id, playbook]) => [id, builtIn(id, playbook)]));
  const problems: string[] = [];
  const dir = paths.playbooksDir(companyId);
  const files = existsSync(dir) ? readdirSync(dir).sort() : [];
  for (const name of files.filter((file) => ['.yaml', '.yml'].includes(extname(file).toLowerCase()))) {
    const file = join(dir, name);
    const id = basename(name, extname(name));
    try {
      found.set(id, { ...parsePlaybook(readFileSync(file, 'utf8')), id, file, origin: id in BUILTIN_PLAYBOOKS ? 'customized' : 'client' });
    } catch (error) {
      problems.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { playbooks: [...found.values()], problems };
}

export function findPlaybook(paths: DataPaths, companyId: string, playbookId: string): PlaybookSummary {
  const playbook = listPlaybooks(paths, companyId).playbooks.find((item) => item.id === playbookId);
  if (!playbook) throw new Error('This guide no longer exists.');
  return playbook;
}

export function startGuide(playbook: PlaybookSummary): TaskGuide {
  return { playbookId: playbook.id, name: playbook.name, type: playbook.type, steps: playbook.steps, current: 0, promptPending: true };
}

function writePlaybook(paths: DataPaths, companyId: string, id: string, playbook: Playbook): string {
  const dir = paths.playbooksDir(companyId);
  const file = join(dir, `${id}.yaml`);
  if (existsSync(file)) throw new Error(`There is already a guide file called ${id}.yaml.`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(file, stringify(playbook, { lineWidth: 0 }), { mode: 0o600 });
  return file;
}

export function customizePlaybook(paths: DataPaths, companyId: string, playbookId: string): string {
  const playbook = BUILTIN_PLAYBOOKS[playbookId];
  if (!playbook) throw new Error('Only a built-in guide can be customized.');
  return writePlaybook(paths, companyId, playbookId, playbook);
}

export function createPlaybook(paths: DataPaths, companyId: string, name: string): string {
  const id = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!id) throw new Error('Name the guide with at least one letter or number.');
  if (id in BUILTIN_PLAYBOOKS) throw new Error(`A built-in guide already uses this name. Customize ${BUILTIN_PLAYBOOKS[id]?.name} instead.`);
  return writePlaybook(paths, companyId, id, {
    name: name.trim(),
    steps: [
      { name: 'First step', prompt: 'Describe what the agent should do for "{task}". Do not post or publish anything yet.' },
      { name: 'Your check', you: 'Describe what you do yourself before the agent continues.' },
      { name: 'Publish', approval: true, prompt: 'Describe what the agent publishes after you approve it.' },
    ],
  });
}

export function removePlaybook(paths: DataPaths, companyId: string, playbookId: string): void {
  const file = findPlaybook(paths, companyId, playbookId).file;
  if (!file) throw new Error('A built-in guide cannot be removed.');
  rmSync(file);
}
