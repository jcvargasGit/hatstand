import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { ClientFile, ClientFileContent, ClientFileScope } from '../shared/api';
import type { Company } from '../shared/schemas';
import { areaFolder } from '../shared/areas';
import { activeKnowledgeDir, activePlanning, activePluginDir } from './active-folders';
import type { DataPaths } from './paths';

const TEXT_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.json', '.yaml', '.yml', '.toml', '.sh', '.py', '.js', '.ts', '.sql']);
const SKIPPED_FOLDERS = new Set(['node_modules', '.git']);
const MAX_FILES = 2000;
const MAX_DEPTH = 8;
const MAX_FILE_BYTES = 1024 * 1024;

type Root = { dir: string; scope: ClientFileScope };

function clientRoots(paths: DataPaths, company: Company): Root[] {
  return [
    { dir: activePluginDir(paths, company), scope: 'llm-config' as const },
    { dir: activeKnowledgeDir(paths, company), scope: 'knowledge' as const },
    { dir: paths.playbooksDir(company.id), scope: 'guides' as const },
    { dir: activePlanning(paths, company).path, scope: 'planning' as const },
    ...company.subdomains.map((area) => ({ dir: paths.areaDir(company.id, areaFolder(area)), scope: 'areas' as const })),
  ].filter((root) => existsSync(root.dir));
}

function walk(dir: string, depth: number, found: string[]): void {
  if (depth > MAX_DEPTH) return;
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (found.length >= MAX_FILES) return;
    if (entry.name.startsWith('.') || SKIPPED_FOLDERS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, depth + 1, found);
    else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) found.push(path);
  }
}

export function listClientFiles(paths: DataPaths, company: Company): ClientFile[] {
  const instructions = company.context.instructionsFile;
  const files: ClientFile[] =
    instructions && existsSync(instructions)
      ? [{ path: instructions, name: basename(instructions), folder: 'Instructions', scope: 'llm-config' }]
      : [];
  for (const root of clientRoots(paths, company)) {
    const found: string[] = [];
    walk(root.dir, 0, found);
    for (const path of found) {
      files.push({ path, name: relative(root.dir, path), folder: root.dir, scope: root.scope });
    }
  }
  return files;
}

function isInside(parent: string, child: string): boolean {
  const fromParent = relative(parent, child);
  return fromParent !== '' && !fromParent.startsWith('..') && !isAbsolute(fromParent);
}

export function allowedFile(paths: DataPaths, company: Company, path: string): string {
  if (!isAbsolute(path) || !existsSync(path) || !lstatSync(path).isFile()) {
    throw new Error(`${path} is not a file of this client.`);
  }
  const real = realpathSync(path);
  const instructions = company.context.instructionsFile;
  const isInstructions = instructions !== undefined && existsSync(instructions) && realpathSync(instructions) === real;
  const inRoot = clientRoots(paths, company).some((root) => isInside(realpathSync(root.dir), real));
  if (!isInstructions && !(inRoot && TEXT_EXTENSIONS.has(extname(real).toLowerCase()))) {
    throw new Error(`${path} is not a file of this client.`);
  }
  return real;
}

export function readClientFile(paths: DataPaths, company: Company, path: string): ClientFileContent {
  const file = allowedFile(paths, company, path);
  if (statSync(file).size > MAX_FILE_BYTES) throw new Error('This file is over 1 MB. Open it in your editor instead.');
  return { content: readFileSync(file, 'utf8') };
}

const DOCUMENT_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u;

function documentFolder(paths: DataPaths, company: Company, where: string): string {
  if (where === 'knowledge') return activeKnowledgeDir(paths, company);
  const area = where.startsWith('area:') ? company.subdomains.find((item) => `area:${item.id}` === where) : undefined;
  if (area) return paths.areaDir(company.id, areaFolder(area));
  const planning = activePlanning(paths, company);
  const allowed = where === '.' || planning.places.some((place) => place.folder === where);
  if (!allowed) throw new Error('Choose where to save this document.');
  const folder = resolve(planning.path, where);
  if (folder !== resolve(planning.path) && !isInside(resolve(planning.path), folder)) throw new Error('This folder is outside the planning folder.');
  return folder;
}

export function createDocument(paths: DataPaths, company: Company, where: string, rawName: string): string {
  const name = rawName.trim();
  if (!DOCUMENT_NAME.test(name)) throw new Error('Use letters, numbers, spaces, dots, dashes or underscores in the name.');
  const folder = documentFolder(paths, company, where);
  const file = join(folder, extname(name) ? name : `${name}.md`);
  if (!TEXT_EXTENSIONS.has(extname(file).toLowerCase())) throw new Error('Use a text file, such as a .md file.');
  if (existsSync(file)) throw new Error(`There is already a file called ${basename(file)} here.`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(file, `# ${basename(file, extname(file))}\n`);
  return file;
}
