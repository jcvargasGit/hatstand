import type { EditorView } from '@codemirror/view';
import { insertLink, toggleInline, toggleLinePrefix, type FormatEdit, type InlineFormat, type LineFormat } from './markdown-format';

export type MarkdownFormat = InlineFormat | LineFormat | 'link';

const LINE_FORMATS: readonly string[] = ['heading', 'bullet', 'numbered', 'checklist'] satisfies LineFormat[];

const isLineFormat = (format: MarkdownFormat): format is LineFormat => LINE_FORMATS.includes(format);

function editFor(format: MarkdownFormat, text: string, from: number, to: number): FormatEdit {
  if (format === 'link') return insertLink(text, from, to);
  if (isLineFormat(format)) return toggleLinePrefix(text, from, to, format);
  return toggleInline(text, from, to, format);
}

export function applyMarkdownFormat(view: EditorView, format: MarkdownFormat): boolean {
  const { from, to } = view.state.selection.main;
  const edit = editFor(format, view.state.doc.toString(), from, to);
  view.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert }, selection: { anchor: edit.selectionFrom, head: edit.selectionTo }, scrollIntoView: true });
  view.focus();
  return true;
}
