import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { areaFolder, defaultArea } from '../shared/areas';
import type { Company } from '../shared/schemas';
import type { DataPaths } from './paths';
import type { Store } from './store';

const PRIVATE_DIR = 0o700;
const DISPOSABLE = new Set(['.DS_Store']);

export const OLD_PROJECT_STARTER_FILES: Record<string, string> = {
  'Instructions.md': '# Instructions\n\nHow this project works: what is expected, its rules and what to avoid. Agents read this file.\n',
  'Notes.md': '# Notes\n\nWhat you have learned, and what is pending.\n',
  'Tips.md': '# Tips\n\nShortcuts and things that saved you time.\n',
};

export type FolderMigrationReport = { companyId: string; backup?: string; movedOldProjects: string[] };

function hasTaskWithoutArea(paths: DataPaths, companyId: string): boolean {
  const dir = paths.tasksDir(companyId);
  if (!existsSync(dir)) return false;
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .some((name) => {
      try {
        return !(JSON.parse(readFileSync(join(dir, name), 'utf8')) as { subdomainId?: unknown }).subdomainId;
      } catch {
        return false;
      }
    });
}

export function needsFolderMigration(paths: DataPaths, company: Company): boolean {
  return !defaultArea(company) || company.subdomains.some((area) => !area.folder) || existsSync(paths.oldProjectsDir(company.id)) || hasTaskWithoutArea(paths, company.id);
}

function backUp(paths: DataPaths, companyId: string, stamp: string): string {
  const target = join(paths.backupsDir, `folders-${stamp}`, companyId);
  mkdirSync(target, { recursive: true, mode: PRIVATE_DIR });
  for (const source of [paths.companyFile(companyId), paths.areasDir(companyId), paths.oldProjectsDir(companyId), paths.tasksDir(companyId)]) {
    if (existsSync(source)) cpSync(source, join(target, source.slice(paths.company(companyId).length + 1)), { recursive: true });
  }
  return target;
}

const isStarterFile = (path: string, name: string) => lstatSync(path).isFile() && OLD_PROJECT_STARTER_FILES[name] === readFileSync(path, 'utf8');

function freePath(dir: string, name: string): string {
  const dot = name.lastIndexOf('.');
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  let candidate = join(dir, name);
  for (let copy = 2; existsSync(candidate); copy += 1) candidate = join(dir, `${stem}-${copy}${extension}`);
  return candidate;
}

function removeIfEmpty(dir: string): void {
  const left = readdirSync(dir).filter((name) => !DISPOSABLE.has(name));
  if (left.length === 0) rmSync(dir, { recursive: true, force: true });
}

export function moveOldProjectFolders(paths: DataPaths, company: Company): string[] {
  const root = paths.oldProjectsDir(company.id);
  const core = defaultArea(company);
  if (!existsSync(root) || !core) return [];
  const moved: string[] = [];
  for (const project of readdirSync(root)) {
    const folder = join(root, project);
    if (DISPOSABLE.has(project)) continue;
    if (!lstatSync(folder).isDirectory()) {
      const loose = join(paths.areaDir(company.id, areaFolder(core)), 'from-old-projects');
      mkdirSync(loose, { recursive: true, mode: PRIVATE_DIR });
      const destination = freePath(loose, project);
      renameSync(folder, destination);
      moved.push(destination);
      continue;
    }
    const target = join(paths.areaDir(company.id, areaFolder(core)), `from-old-project-${project.slice(0, 8)}`);
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      if (DISPOSABLE.has(name) || isStarterFile(path, name)) {
        rmSync(path, { recursive: true, force: true });
        continue;
      }
      mkdirSync(target, { recursive: true, mode: PRIVATE_DIR });
      const destination = freePath(target, name);
      renameSync(path, destination);
      moved.push(destination);
    }
    removeIfEmpty(folder);
  }
  removeIfEmpty(root);
  return moved;
}

export function migrateClientFolders(store: Store, paths: DataPaths, companyId: string, stamp = new Date().toISOString().replace(/[:.]/g, '-')): FolderMigrationReport {
  const before = store.readCompany(companyId);
  if (!needsFolderMigration(paths, before)) return { companyId, movedOldProjects: [] };
  const backup = backUp(paths, companyId, stamp);
  const company = store.saveCompany(before);
  const movedOldProjects = moveOldProjectFolders(paths, company);
  store.listTasks(companyId);
  return { companyId, backup, movedOldProjects };
}
