import { existsSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export type EditorTarget = { kind: 'folder' | 'file'; path: string };

const real = (path: string): string => (existsSync(path) ? realpathSync(path) : resolve(path));

/**
 * What the editor may open for a client: one of its folders, a file inside one of them, or one of its
 * own files, such as a document the agent wrote. Anything else is refused, so a path from the page
 * cannot reach outside the client.
 */
export function editorTarget(folders: string[], files: string[], path: string): EditorTarget | null {
  const wanted = real(path);
  const knownFolders = folders.map(real);
  if (knownFolders.includes(wanted)) return { kind: 'folder', path: wanted };
  if (files.map(real).includes(wanted)) return { kind: 'file', path: wanted };
  return knownFolders.some((folder) => wanted.startsWith(`${folder}${sep}`)) ? { kind: 'file', path: wanted } : null;
}
