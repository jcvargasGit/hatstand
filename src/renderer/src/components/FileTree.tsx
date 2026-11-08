import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { useState } from 'react';
import type { ClientFile } from '../../../shared/api';
import type { TreeNode } from '../lib/file-tree';

type FileTreeProps = {
  nodes: TreeNode[];
  selectedPath: string | null;
  changedPaths: string[];
  onSelect: (file: ClientFile) => void;
  depth?: number;
};

export function FileTree({ nodes, selectedPath, changedPaths, onSelect, depth = 0 }: FileTreeProps) {
  const [closed, setClosed] = useState<string[]>([]);
  return (
    <ul className="file-tree" role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? 'Files' : undefined}>
      {nodes.map((node) => {
        const { file } = node;
        const open = !closed.includes(node.id);
        const indent = { paddingLeft: `${0.45 + depth * 0.85}rem` };
        return (
          <li key={node.id} role="treeitem" aria-expanded={file ? undefined : open} aria-selected={file ? selectedPath === file.path : undefined}>
            {file ? (
              <button type="button" className="file-tree-row" style={indent} aria-current={selectedPath === file.path ? 'true' : undefined} title={file.path} onClick={() => onSelect(file)}>
                <FileText size={13} />
                <span>{node.name}</span>
                {changedPaths.includes(file.path) && <small title="Not committed">M</small>}
              </button>
            ) : (
              <>
                <button type="button" className="file-tree-row is-folder" style={indent} onClick={() => setClosed(open ? [...closed, node.id] : closed.filter((id) => id !== node.id))}>
                  {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <span>{node.name}</span>
                </button>
                {open && <FileTree nodes={node.children} selectedPath={selectedPath} changedPaths={changedPaths} onSelect={onSelect} depth={depth + 1} />}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
