import { syntaxTree } from '@codemirror/language';
import type { EditorState, Range } from '@codemirror/state';
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

export type MarkdownPart = { type: 'hide' | 'mark'; from: number; to: number; className?: string } | { type: 'line'; from: number; className: string };

const HEADING = /^ATXHeading([1-6])$/;
const INLINE_STYLES: Record<string, string> = {
  Emphasis: 'cm-md-em',
  StrongEmphasis: 'cm-md-strong',
  InlineCode: 'cm-md-code',
  ListMark: 'cm-md-list',
};

function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const last = state.doc.lineAt(range.to).number;
    for (let line = state.doc.lineAt(range.from).number; line <= last; line += 1) lines.add(line);
  }
  return lines;
}

export function markdownParts(state: EditorState, editing = true): MarkdownPart[] {
  const parts: MarkdownPart[] = [];
  const active = editing ? activeLines(state) : new Set<number>();
  const hide = (from: number, to: number) => {
    if (from < to && !active.has(state.doc.lineAt(from).number)) parts.push({ type: 'hide', from, to });
  };

  syntaxTree(state).iterate({
    enter({ name, from, to, node }) {
      const heading = HEADING.exec(name);
      const parent = node.parent;
      if (heading) {
        parts.push({ type: 'line', from: state.doc.lineAt(from).from, className: `cm-md-h${heading[1]}` });
      } else if (name === 'HeaderMark') {
        hide(from, state.doc.sliceString(to, to + 1) === ' ' ? to + 1 : to);
      } else if (name === 'EmphasisMark') {
        hide(from, to);
      } else if (name === 'CodeMark' && parent?.name === 'InlineCode') {
        hide(from, to);
      } else if (name === 'FencedCode') {
        const last = state.doc.lineAt(to).number;
        for (let line = state.doc.lineAt(from).number; line <= last; line += 1) parts.push({ type: 'line', from: state.doc.line(line).from, className: 'cm-md-codeblock' });
      } else if (name === 'Link' && node.getChild('URL')) {
        parts.push({ type: 'mark', from, to, className: 'cm-md-link' });
      } else if ((name === 'LinkMark' || name === 'URL') && parent?.name === 'Link' && parent.getChild('URL')) {
        hide(from, to);
      } else if (name === 'URL' && parent?.name !== 'Image' && parent?.name !== 'Link') {
        parts.push({ type: 'mark', from, to, className: 'cm-md-link' });
      } else if (INLINE_STYLES[name] && from < to) {
        parts.push({ type: 'mark', from, to, className: INLINE_STYLES[name] });
      }
    },
  });
  return parts;
}

const HIDDEN = Decoration.replace({});

function toDecoration(part: MarkdownPart): Range<Decoration> {
  if (part.type === 'line') return Decoration.line({ class: part.className }).range(part.from);
  if (part.type === 'hide') return HIDDEN.range(part.from, part.to);
  return Decoration.mark({ class: part.className ?? '' }).range(part.from, part.to);
}

const decorationsOf = (view: EditorView): DecorationSet => Decoration.set(markdownParts(view.state, view.hasFocus).map(toDecoration), true);

export const markdownLivePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = decorationsOf(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.focusChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = decorationsOf(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
