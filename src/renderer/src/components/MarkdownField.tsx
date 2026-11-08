import type { EditorView } from '@codemirror/view';
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { applyMarkdownFormat } from '../lib/markdown-commands';
import { MarkdownEditor, type MarkdownEditorMode } from './MarkdownEditor';
import { MarkdownToolbar } from './MarkdownToolbar';
import { MarkdownView } from './MarkdownView';

type MarkdownFieldProps = {
  value: string;
  label: string;
  placeholder?: string;
  rows?: number;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
};

const LINE_HEIGHT_EM = 1.45;

export function MarkdownField({ value, label, placeholder = 'Click to write', rows = 3, onChange, onCommit }: MarkdownFieldProps) {
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<MarkdownEditorMode>('rich');
  const editingNow = useRef(editing);
  const refocusView = useRef(false);
  const viewer = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);

  useEffect(() => {
    if (editing || !refocusView.current) return;
    refocusView.current = false;
    viewer.current?.focus();
  }, [editing]);

  const open = () => {
    editingNow.current = true;
    setMode('rich');
    setEditing(true);
  };

  const leave = (returnFocus: boolean) => {
    if (!editingNow.current) return;
    editingNow.current = false;
    refocusView.current = returnFocus;
    const text = editor.current?.state.doc.toString() ?? value;
    setEditing(false);
    onCommit?.(text);
  };

  const leaveWhenFocusGoesOut = (event: FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    leave(false);
  };

  const openUnlessLink = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('a')) return;
    open();
  };

  const openFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    open();
  };

  const minHeight = `${rows * LINE_HEIGHT_EM}em`;

  if (!editing) {
    return (
      <div className="markdown-field">
        <div ref={viewer} className="markdown-field-view" role="button" tabIndex={0} aria-label={label} title="Click to edit" style={{ minHeight }} onClick={openUnlessLink} onKeyDown={openFromKeyboard}>
          {value.trim() ? <MarkdownView text={value} /> : <span className="markdown-field-placeholder">{placeholder}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className={`markdown-field is-editing is-${mode}`} onBlur={leaveWhenFocusGoesOut}>
      <MarkdownToolbar mode={mode} onModeChange={setMode} onFormat={(format) => editor.current && applyMarkdownFormat(editor.current, format)} />
      <div className="markdown-field-editor" style={{ minHeight }}>
        <MarkdownEditor initialValue={value} label={label} placeholderText={placeholder} mode={mode} autoFocus editorRef={editor} onChange={onChange} onLeave={() => leave(true)} />
      </div>
    </div>
  );
}
