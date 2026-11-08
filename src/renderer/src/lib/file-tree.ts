import type { ClientFile } from '../../../shared/api';

export type TreeNode = {
  id: string;
  name: string;
  file?: ClientFile;
  children: TreeNode[];
};

const baseName = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

function insert(parent: TreeNode, parts: string[], file: ClientFile): void {
  const [name = '', ...rest] = parts;
  if (rest.length === 0) {
    parent.children.push({ id: file.path, name, file, children: [] });
    return;
  }
  const id = `${parent.id}/${name}`;
  let folder = parent.children.find((child) => child.id === id);
  if (!folder) {
    folder = { id, name, children: [] };
    parent.children.push(folder);
  }
  insert(folder, rest, file);
}

function sorted(node: TreeNode): TreeNode {
  const children = node.children.map(sorted).sort((a, b) => Number(Boolean(a.file)) - Number(Boolean(b.file)) || a.name.localeCompare(b.name));
  return { ...node, children };
}

export function buildFileTree(files: ClientFile[], rootName: (folder: string) => string = baseName): TreeNode[] {
  const roots: TreeNode[] = [];
  for (const file of files) {
    let root = roots.find((item) => item.id === file.folder);
    if (!root) {
      root = { id: file.folder, name: rootName(file.folder), children: [] };
      roots.push(root);
    }
    insert(root, file.name.split('/'), file);
  }
  return roots.map(sorted);
}
