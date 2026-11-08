export type FormatEdit = { from: number; to: number; insert: string; selectionFrom: number; selectionTo: number };

export type InlineFormat = 'bold' | 'italic' | 'code';
export type LineFormat = 'heading' | 'bullet' | 'numbered' | 'checklist';

const INLINE_MARKS: Record<InlineFormat, string> = { bold: '**', italic: '*', code: '`' };
const LINE_PREFIXES: Record<LineFormat, string> = { heading: '## ', bullet: '- ', numbered: '1. ', checklist: '- [ ] ' };
const ANY_LINE_PREFIX = /^(#{1,6} |- \[[ xX]\] |[-*+] |\d+\. )/;

export function toggleInline(text: string, from: number, to: number, format: InlineFormat): FormatEdit {
  const mark = INLINE_MARKS[format];
  const before = text.slice(from - mark.length, from);
  const after = text.slice(to, to + mark.length);
  const insideMarks = before === mark && after === mark && !(format === 'italic' && (text[from - 2] === '*' || text[to + 1] === '*'));
  if (insideMarks) {
    const selected = text.slice(from, to);
    const start = from - mark.length;
    return { from: start, to: to + mark.length, insert: selected, selectionFrom: start, selectionTo: start + selected.length };
  }
  const selected = text.slice(from, to);
  return { from, to, insert: `${mark}${selected}${mark}`, selectionFrom: from + mark.length, selectionTo: to + mark.length };
}

export function insertLink(text: string, from: number, to: number): FormatEdit {
  const label = text.slice(from, to) || 'link';
  const url = 'https://';
  const insert = `[${label}](${url})`;
  const urlStart = from + label.length + 3;
  return { from, to, insert, selectionFrom: urlStart, selectionTo: urlStart + url.length };
}

function lineStart(text: string, position: number): number {
  return text.lastIndexOf('\n', position - 1) + 1;
}

function lineEnd(text: string, position: number): number {
  const end = text.indexOf('\n', position);
  return end === -1 ? text.length : end;
}

export function toggleLinePrefix(text: string, from: number, to: number, format: LineFormat): FormatEdit {
  const prefix = LINE_PREFIXES[format];
  const start = lineStart(text, from);
  const end = lineEnd(text, to);
  const lines = text.slice(start, end).split('\n');
  const allHavePrefix = lines.every((line) => line.startsWith(prefix));
  const changed = lines.map((line) => (allHavePrefix ? line.slice(prefix.length) : prefix + line.replace(ANY_LINE_PREFIX, ''))).join('\n');
  return { from: start, to: end, insert: changed, selectionFrom: start + (lines.length === 1 ? changed.length : 0), selectionTo: start + changed.length };
}
