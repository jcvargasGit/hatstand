import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ClientFolderSection } from '../shared/api';
import type { Company, PlanningPlace } from '../shared/schemas';
import { findGitRoot, type DataPaths } from './paths';

export type ActivePlanning = { path: string; places: PlanningPlace[]; hasGit: boolean };

const MAX_COUNTED_FILES = 2000;
const HIDDEN_PLUGIN_FILES = new Set(['.mcp.json', '.lsp.json']);
const MAX_PAST_FOLDERS = 30;
const FOLDER_SECTIONS: ClientFolderSection[] = ['knowledge', 'llm-config', 'planning'];
const PLUGIN_ENTRIES = ['.claude-plugin', 'skills', 'agents', 'commands', 'hooks', '.mcp.json', 'SKILL.md'];

export const activeKnowledgeDir = (paths: DataPaths, company: Company): string => company.context.knowledgeDir ?? paths.knowledgeDir(company.id);

export const activePluginDir = (paths: DataPaths, company: Company): string => company.context.pluginDir ?? paths.pluginDir(company.id);

export function activePlanning(paths: DataPaths, company: Company): ActivePlanning {
  const custom = company.planning;
  if (!custom) return { path: paths.planningDir(company.id), places: [], hasGit: false };
  return { ...custom, hasGit: findGitRoot(custom.path) !== null };
}

export function activeFolder(paths: DataPaths, company: Company, section: ClientFolderSection): string {
  if (section === 'knowledge') return activeKnowledgeDir(paths, company);
  if (section === 'llm-config') return activePluginDir(paths, company);
  return activePlanning(paths, company).path;
}

const customFolder = (company: Company, section: ClientFolderSection): string | undefined => {
  if (section === 'knowledge') return company.context.knowledgeDir;
  if (section === 'llm-config') return company.context.pluginDir;
  return company.planning?.path;
};

export function withFolderHistory(previous: Company, next: Company, now: string): Company {
  const left = FOLDER_SECTIONS.flatMap((section) => {
    const before = customFolder(previous, section);
    return before && before !== customFolder(next, section) ? [{ section, path: before, leftAt: now }] : [];
  });
  const seen = new Set<string>();
  const pastFolders = [...left, ...(previous.pastFolders ?? [])].filter(({ section, path }) => {
    const key = `${section}:${path}`;
    if (seen.has(key) || customFolder(next, section) === path) return false;
    seen.add(key);
    return true;
  });
  return { ...next, pastFolders: pastFolders.slice(0, MAX_PAST_FOLDERS) };
}

export function countFolderFiles(root: string): number {
  if (!existsSync(root)) return 0;
  let found = 0;
  const pending = [root];
  for (let folder = pending.pop(); folder !== undefined && found < MAX_COUNTED_FILES; folder = pending.pop()) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || (entry.name.startsWith('.') && !HIDDEN_PLUGIN_FILES.has(entry.name))) continue;
      if (entry.isDirectory()) pending.push(join(folder, entry.name));
      else if (folder !== root || entry.name !== 'README.md') found += 1;
    }
  }
  return Math.min(found, MAX_COUNTED_FILES);
}

const hasPluginEntry = (dir: string) => PLUGIN_ENTRIES.some((name) => existsSync(join(dir, name)));

export function looksLikePlugin(dir: string): boolean {
  if (!existsSync(dir)) return false;
  if (hasPluginEntry(dir)) return true;
  return readdirSync(dir, { withFileTypes: true }).some((entry) => entry.isDirectory() && hasPluginEntry(join(dir, entry.name)));
}
