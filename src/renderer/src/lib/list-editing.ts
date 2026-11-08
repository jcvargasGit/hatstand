export type TextEdit = { value: string; selectionStart: number; selectionEnd: number };

const INDENT = '  ';
const LIST_LINE = /^(\s*)(?:([-*+•])|(\d+)([.)]))\s+(\[[ xX]?\]\s+)?(.*)$/;

const lineStartAt = (value: string, position: number) => value.lastIndexOf('\n', position - 1) + 1;

function lineEndAt(value: string, position: number): number {
  const end = value.indexOf('\n', position);
  return end === -1 ? value.length : end;
}

function nextMarker(bullet: string | undefined, number: string | undefined, separator: string | undefined, checkbox: string | undefined): string {
  const marker = bullet ?? `${Number(number) + 1}${separator}`;
  return checkbox ? `${marker} [ ] ` : `${marker} `;
}

export function continueList(value: string, cursor: number): TextEdit | null {
  const start = lineStartAt(value, cursor);
  const end = lineEndAt(value, cursor);
  const match = value.slice(start, end).match(LIST_LINE);
  if (!match) return null;
  const [, indent = '', bullet, number, separator, checkbox, content = ''] = match;
  if (content.trim() === '') {
    return { value: value.slice(0, start) + value.slice(end), selectionStart: start, selectionEnd: start };
  }
  const inserted = `\n${indent}${nextMarker(bullet, number, separator, checkbox)}`;
  const after = cursor + inserted.length;
  return { value: value.slice(0, cursor) + inserted + value.slice(cursor), selectionStart: after, selectionEnd: after };
}

export function indentLines(value: string, selectionStart: number, selectionEnd: number, outdent: boolean): TextEdit | null {
  const start = lineStartAt(value, selectionStart);
  const end = lineEndAt(value, selectionEnd);
  const lines = value.slice(start, end).split('\n');
  if (!lines.some((line) => LIST_LINE.test(line))) return null;
  const changed = lines.map((line) => (outdent ? line.replace(/^ {1,2}/, '') : `${INDENT}${line}`));
  const firstChange = (changed[0] ?? '').length - (lines[0] ?? '').length;
  const totalChange = changed.join('\n').length - lines.join('\n').length;
  if (totalChange === 0) return null;
  return {
    value: value.slice(0, start) + changed.join('\n') + value.slice(end),
    selectionStart: Math.max(start, selectionStart + firstChange),
    selectionEnd: Math.max(start, selectionEnd + totalChange),
  };
}
