import type { EditorView } from '@codemirror/view';
import { useRef, useState } from 'react';
import { applyMarkdownFormat } from '../lib/markdown-commands';
import { MarkdownEditor, type MarkdownEditorMode } from './MarkdownEditor';
import { MarkdownToolbar } from './MarkdownToolbar';

type MarkdownComposerProps = {
  initialValue: string;
  label: string;
  placeholderText: string;
  className?: string;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onLeave: () => void;
};

/**
 * A Markdown editor that is always open, with its formatting toolbar. Use it where a field that opens on
 * click would move what is under it, such as the buttons of a dialog.
 */
export function MarkdownComposer({ initialValue, label, placeholderText, className, autoFocus = false, onChange, onBlur, onLeave }: MarkdownComposerProps) {
  const [mode, setMode] = useState<MarkdownEditorMode>('rich');
  const editor = useRef<EditorView | null>(null);

  return (
    <div className={['markdown-field', 'is-editing', `is-${mode}`, className].filter(Boolean).join(' ')}>
      <MarkdownToolbar mode={mode} onModeChange={setMode} onFormat={(format) => editor.current && applyMarkdownFormat(editor.current, format)} />
      <div className="markdown-field-editor">
        <MarkdownEditor initialValue={initialValue} label={label} placeholderText={placeholderText} mode={mode} autoFocus={autoFocus} editorRef={editor} onChange={onChange} onBlur={onBlur} onLeave={onLeave} />
      </div>
    </div>
  );
}
