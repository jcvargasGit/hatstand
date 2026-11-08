import { Bold, Code, FileCode, Heading2, Italic, Link, List, ListChecks, ListOrdered, type LucideIcon } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { MarkdownFormat } from '../lib/markdown-commands';
import { editorShortcutLabel } from '../lib/shortcuts';
import type { MarkdownEditorMode } from './MarkdownEditor';

type ToolbarAction = { format: MarkdownFormat; label: string; icon: LucideIcon; key?: string };

const ACTIONS: ToolbarAction[] = [
  { format: 'bold', label: 'Bold', icon: Bold, key: 'B' },
  { format: 'italic', label: 'Italic', icon: Italic, key: 'I' },
  { format: 'code', label: 'Code', icon: Code },
  { format: 'link', label: 'Link', icon: Link, key: 'K' },
  { format: 'heading', label: 'Heading', icon: Heading2 },
  { format: 'bullet', label: 'Bulleted list', icon: List },
  { format: 'numbered', label: 'Numbered list', icon: ListOrdered },
  { format: 'checklist', label: 'Checklist', icon: ListChecks },
];

const keepEditorFocus = (event: MouseEvent) => event.preventDefault();

type MarkdownToolbarProps = {
  mode: MarkdownEditorMode;
  onFormat: (format: MarkdownFormat) => void;
  onModeChange: (mode: MarkdownEditorMode) => void;
};

export function MarkdownToolbar({ mode, onFormat, onModeChange }: MarkdownToolbarProps) {
  const showingSource = mode === 'markdown';
  return (
    <div className="markdown-toolbar" role="toolbar" aria-label="Formatting">
      {ACTIONS.map(({ format, label, icon: Icon, key }) => (
        <button key={format} type="button" className="quiet" aria-label={label} title={key ? `${label} (${editorShortcutLabel(key)})` : label} onMouseDown={keepEditorFocus} onClick={() => onFormat(format)}>
          <Icon size={14} />
        </button>
      ))}
      <button
        type="button"
        className="quiet markdown-mode"
        aria-pressed={showingSource}
        title={showingSource ? 'Show the formatted text' : 'Show and edit the Markdown source'}
        onMouseDown={keepEditorFocus}
        onClick={() => onModeChange(showingSource ? 'rich' : 'markdown')}
      >
        <FileCode size={14} />
        Markdown
      </button>
    </div>
  );
}
