import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import type { RepoLayout } from '../shared/api';

const IGNORED_FOLDERS = new Set(['node_modules', 'vendor', 'dist', 'build', 'target', 'coverage', 'out']);
const CONVENTIONAL_PARENTS = ['apps', 'packages', 'services', 'libs', 'modules'];
const MIN_CONVENTIONAL_FOLDERS = 2;
const MAX_FOLDERS = 400;

const patternsSchema = z.object({ packages: z.array(z.string()) });
const packageJsonSchema = z.object({ workspaces: z.union([z.array(z.string()), patternsSchema]) });

const readText = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : null);

function subfolders(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !IGNORED_FOLDERS.has(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function expandPattern(repoPath: string, pattern: string): string[] {
  const parts = pattern.replace(/^\.\//, '').replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length === 0 || parts.includes('..')) return [];
  return parts.reduce<string[]>(
    (found, part) =>
      found.flatMap((parent) => {
        const names = part === '*' || part === '**' ? subfolders(join(repoPath, parent)) : [part];
        return names.map((name) => (parent ? `${parent}/${name}` : name)).filter((path) => existsSync(join(repoPath, path)));
      }),
    [''],
  );
}

function pnpmPatterns(repoPath: string): string[] | null {
  const text = readText(join(repoPath, 'pnpm-workspace.yaml'));
  return text === null ? null : (patternsSchema.safeParse(parse(text)).data?.packages ?? []);
}

function jsonPatterns(file: string, schema: z.ZodType<string[]>): string[] | null {
  const text = readText(file);
  if (text === null) return null;
  try {
    return schema.safeParse(JSON.parse(text)).data ?? null;
  } catch {
    return null;
  }
}

function goWorkPatterns(repoPath: string): string[] | null {
  const text = readText(join(repoPath, 'go.work'));
  if (text === null) return null;
  const block = /^use\s*\(([\s\S]*?)\)/m.exec(text)?.[1];
  const lines = block ? block.split('\n') : [...text.matchAll(/^use\s+(\S+)/gm)].map((match) => match[1] ?? '');
  return lines.map((line) => line.replace(/\/\/.*/, '').trim()).filter(Boolean);
}

function cargoPatterns(repoPath: string): string[] | null {
  const section = /^\[workspace\]([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(readText(join(repoPath, 'Cargo.toml')) ?? '')?.[1];
  const members = section && /members\s*=\s*\[([\s\S]*?)\]/.exec(section)?.[1];
  return members ? [...members.matchAll(/["']([^"']+)["']/g)].map((match) => match[1] ?? '') : null;
}

const conventionalFolders = (repoPath: string) => CONVENTIONAL_PARENTS.flatMap((parent) => subfolders(join(repoPath, parent)).map((name) => `${parent}/${name}`));

function workspaceManifest(repoPath: string): { tool: string; patterns: string[] } | null {
  const workspaces = packageJsonSchema.transform((value) => (Array.isArray(value.workspaces) ? value.workspaces : value.workspaces.packages));
  const candidates: [string, string[] | null][] = [
    ['pnpm workspace', pnpmPatterns(repoPath)],
    ['npm or Yarn workspaces', jsonPatterns(join(repoPath, 'package.json'), workspaces)],
    ['Lerna', jsonPatterns(join(repoPath, 'lerna.json'), patternsSchema.transform((value) => value.packages))],
    ['Go workspace', goWorkPatterns(repoPath)],
    ['Cargo workspace', cargoPatterns(repoPath)],
  ];
  const [tool, patterns] = candidates.find(([, found]) => found !== null) ?? [];
  return tool && patterns ? { tool, patterns } : null;
}

export function detectRepoLayout(repoPath: string): RepoLayout {
  const unique = (folders: string[]) => [...new Set(folders)].sort();
  const manifest = workspaceManifest(repoPath);
  if (manifest) {
    const folders = manifest.patterns.filter((pattern) => !pattern.startsWith('!')).flatMap((pattern) => expandPattern(repoPath, pattern));
    return { tool: manifest.tool, isMonorepo: true, folders: unique(folders) };
  }
  const conventional = conventionalFolders(repoPath);
  const marker = existsSync(join(repoPath, 'nx.json')) ? 'Nx' : existsSync(join(repoPath, 'turbo.json')) ? 'Turborepo' : null;
  if (marker || conventional.length >= MIN_CONVENTIONAL_FOLDERS) {
    return { tool: marker, isMonorepo: true, folders: unique(conventional) };
  }
  return { tool: null, isMonorepo: false, folders: unique(subfolders(repoPath)) };
}

export function listFolders(root: string, depth = 3): string[] {
  const found: string[] = [];
  const walk = (relative: string, level: number) => {
    for (const name of subfolders(join(root, relative)).sort()) {
      if (found.length >= MAX_FOLDERS) return;
      const path = relative ? `${relative}/${name}` : name;
      found.push(path);
      if (level < depth) walk(path, level + 1);
    }
  };
  walk('', 1);
  return found;
}
