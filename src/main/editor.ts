import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Company } from '../shared/schemas';
import { activeKnowledgeDir, activePlanning, activePluginDir } from './active-folders';
import type { DataPaths } from './paths';
import { findExecutable } from './shell';
import { writePrivateFile } from './store';

type EditorInfo = { command: string; name: string; workspaces: boolean; app?: string };

const EDITORS: EditorInfo[] = [
  { command: 'code', name: 'VS Code', workspaces: true, app: '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code' },
  { command: 'cursor', name: 'Cursor', workspaces: true, app: '/Applications/Cursor.app/Contents/Resources/app/bin/cursor' },
  { command: 'windsurf', name: 'Windsurf', workspaces: true, app: '/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf' },
  { command: 'zed', name: 'Zed', workspaces: false },
  { command: 'subl', name: 'Sublime Text', workspaces: false },
  { command: 'idea', name: 'IntelliJ IDEA', workspaces: false },
];

export type FoundEditor = EditorInfo & { executable: string };

export function detectEditor(path: string, appExists: (file: string) => boolean = existsSync): FoundEditor | null {
  for (const editor of EDITORS) {
    const executable = findExecutable(editor.command, path) ?? (editor.app && appExists(editor.app) ? editor.app : null);
    if (executable) return { ...editor, executable };
  }
  return null;
}

function launch(editor: FoundEditor, targets: string[], path: string): void {
  const child = spawn(editor.executable, targets, { detached: true, stdio: 'ignore', env: { ...process.env, PATH: path } });
  child.on('error', () => undefined);
  child.unref();
}

export async function openInEditor(folder: string, path: string, openFolder: (folder: string) => Promise<string>): Promise<string> {
  const editor = detectEditor(path);
  if (editor) {
    launch(editor, [folder], path);
    return editor.name;
  }
  const failure = await openFolder(folder);
  if (failure) throw new Error(failure);
  return 'your file browser';
}

export function openFileInEditor(file: string, path: string): string | null {
  const editor = detectEditor(path);
  if (!editor) return null;
  launch(editor, [file], path);
  return editor.name;
}

export function clientFolders(paths: DataPaths, company: Company): { name: string; path: string }[] {
  const candidates = [
    { name: company.planning ? 'Planning repository' : 'Planning', path: activePlanning(paths, company).path },
    ...company.projects.map((project) => ({ name: project.name, path: project.path })),
    { name: 'Knowledge', path: activeKnowledgeDir(paths, company) },
    { name: 'LLM config', path: activePluginDir(paths, company) },
    { name: 'Task guides', path: paths.playbooksDir(company.id) },
    { name: 'Areas', path: paths.areasDir(company.id) },
  ];
  return candidates.filter((folder, index) => existsSync(folder.path) && candidates.findIndex((other) => other.path === folder.path) === index);
}

export function openClientWorkspace(paths: DataPaths, company: Company, path: string): string {
  const editor = detectEditor(path);
  if (!editor) throw new Error('No code editor was found. Install VS Code, Cursor, Windsurf, Zed or Sublime Text.');
  const folders = clientFolders(paths, company);
  if (!editor.workspaces) {
    launch(editor, folders.map((folder) => folder.path), path);
    return editor.name;
  }
  const file = join(paths.company(company.id), `${company.id}.code-workspace`);
  writePrivateFile(file, JSON.stringify({ folders }, null, 2));
  launch(editor, [file], path);
  return editor.name;
}
