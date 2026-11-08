import type { Idea } from './schemas';

const MAX_TITLE_LENGTH = 120;
const RULE_LINE = /^[\s│┃|├┤┼─━┌┐└┘┬┴╭╮╯╰=+:-]+$/;
const TITLE_MARKER = /^#{1,6}\s+/;
const LIST_MARKER = /^(?:[-*+•◦▪‣]\s+|\d+[.)]\s+|\[[ xX]?\]\s+|#{1,6}\s+)/;
const SUB_MARKER = /^[a-zA-Z][.)]\s+/;
const leadingSpace = (line: string) => (line.match(/^\s*/)?.[0] ?? '').replace(/\t/g, '  ').length;

function withoutMarkers(line: string): string {
  let current = line.trim();
  while (LIST_MARKER.test(current)) current = current.replace(LIST_MARKER, '');
  return current;
}

function tableCells(line: string): string[] | null {
  const isTable = line.includes('│') || line.includes('┃') || (line.match(/\|/g) ?? []).length >= 2;
  if (!isTable) return null;
  return line.split(/[│┃|]/).map((cell) => cell.trim()).filter(Boolean);
}

function fitTitle(title: string, description: string): Idea {
  if (title.length <= MAX_TITLE_LENGTH) return { title, description };
  return { title: `${title.slice(0, MAX_TITLE_LENGTH).trimEnd()}…`, description: [title, description].filter(Boolean).join('\n') };
}

export function splitPaste(text: string): Idea[] {
  const ideas: Idea[] = [];
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '' && !RULE_LINE.test(line));
  const baseIndent = Math.min(...lines.map(leadingSpace));
  let lastIsTitle = false;
  for (const raw of lines) {
    const line = raw.trim();
    const cells = tableCells(raw);
    const last = ideas.at(-1);
    const nested = leadingSpace(raw) > baseIndent;
    const isItem = (LIST_MARKER.test(line) && !TITLE_MARKER.test(line)) || (nested && SUB_MARKER.test(line));
    if (cells) {
      const [title, ...rest] = cells;
      if (title) ideas.push(fitTitle(withoutMarkers(title), rest.join(', ')));
      lastIsTitle = false;
    } else if (TITLE_MARKER.test(line)) {
      ideas.push(fitTitle(withoutMarkers(raw), ''));
      lastIsTitle = true;
    } else if (isItem && last && (lastIsTitle || nested)) {
      ideas[ideas.length - 1] = { ...last, checklist: [...(last.checklist ?? []), withoutMarkers(raw).replace(SUB_MARKER, '')] };
    } else if (isItem) {
      ideas.push(fitTitle(withoutMarkers(raw), ''));
      lastIsTitle = false;
    } else if (last) {
      ideas[ideas.length - 1] = { ...last, description: [last.description, line].filter(Boolean).join('\n') };
    } else {
      ideas.push(fitTitle(line, ''));
      lastIsTitle = true;
    }
  }
  return ideas.filter((idea) => idea.title !== '');
}

export function pasteAsOne(text: string): Idea | null {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '' && !RULE_LINE.test(line));
  const [first] = lines;
  if (!first) return null;
  const cells = tableCells(first);
  const title = withoutMarkers(cells?.[0] ?? first);
  const short = title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH).trimEnd()}…` : title;
  return { title: short, description: text.trim() };
}
