import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { markdownParts } from '../../src/renderer/src/lib/markdown-live-preview';

const stateOf = (doc: string, cursor = doc.length) => EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [markdown({ base: markdownLanguage })] });

const hiddenText = (state: EditorState) =>
  markdownParts(state)
    .filter((part) => part.type === 'hide')
    .map((part) => state.sliceDoc(part.from, 'to' in part ? part.to : part.from));

const classes = (state: EditorState) => markdownParts(state).map((part) => part.className);

describe('Markdown live preview', () => {
  it('shows a heading with its mark hidden once the cursor leaves the line', () => {
    const state = stateOf('# Title\n\nnext');
    expect(classes(state)).toContain('cm-md-h1');
    expect(hiddenText(state)).toEqual(['# ']);
  });

  it('keeps the marks visible on the line with the cursor', () => {
    const state = stateOf('# Title\n\nnext', 3);
    expect(classes(state)).toContain('cm-md-h1');
    expect(hiddenText(state)).toEqual([]);
  });

  it('hides every mark while the person is not editing', () => {
    const state = stateOf('# Title\n\nnext', 3);
    expect(markdownParts(state, false).filter((part) => part.type === 'hide')).toEqual([{ type: 'hide', from: 0, to: 2 }]);
  });

  it('reads #title without the space as plain text', () => {
    expect(classes(stateOf('#title\n\nnext'))).not.toContain('cm-md-h1');
  });

  it('styles bold, italics and inline code', () => {
    const state = stateOf('**bold** *soft* `code`\n\nnext');
    expect(classes(state)).toEqual(expect.arrayContaining(['cm-md-strong', 'cm-md-em', 'cm-md-code']));
    expect(hiddenText(state)).toEqual(['**', '**', '*', '*', '`', '`']);
  });

  it('shows a link as its text', () => {
    const state = stateOf('[docs](https://example.com)\n\nnext');
    expect(classes(state)).toContain('cm-md-link');
    expect(hiddenText(state)).toEqual(['[', ']', '(', 'https://example.com', ')']);
  });

  it('marks lists and code blocks without hiding their text', () => {
    const state = stateOf('- one\n\n```\ncode\n```\n\nnext');
    expect(classes(state)).toEqual(expect.arrayContaining(['cm-md-list', 'cm-md-codeblock']));
    expect(hiddenText(state)).toEqual([]);
  });

  it('leaves images and plain brackets as text', () => {
    const state = stateOf('![alt](a.png) [todo]\n\nnext');
    expect(hiddenText(state)).toEqual([]);
    expect(classes(state)).not.toContain('cm-md-link');
  });
});
