// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MarkdownEditor, type MarkdownEditorMode } from '../../src/renderer/src/components/MarkdownEditor';

beforeAll(() => {
  const noRects = () => Object.assign([], { item: () => null });
  Range.prototype.getClientRects = noRects as unknown as Range['getClientRects'];
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

afterEach(cleanup);

const TEXT = '# Plan\n\nSee https://example.com/page and **this**\n\nlast';

const renderEditor = (mode: MarkdownEditorMode) => {
  const { container } = render(<MarkdownEditor initialValue={TEXT} label="Note" placeholderText="Write" mode={mode} onChange={() => {}} onLeave={() => {}} />);
  return container;
};

/** Every class on the elements between a piece of text and its line. */
const classesAround = (container: HTMLElement, text: string): string[] => {
  const classes: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.includes(text)) continue;
    for (let element = node.parentElement; element && !element.classList.contains('cm-line'); element = element.parentElement) classes.push(...element.classList);
  }
  return classes;
};

describe('the colors of the Markdown editor', () => {
  it.each<MarkdownEditorMode>(['rich', 'markdown'])('gives a pasted address only the link style of the theme, in %s mode', (mode) => {
    const classes = classesAround(renderEditor(mode), 'https://example.com/page');
    expect(classes).toContain('cm-md-link');
    expect(classes.filter((name) => !name.startsWith('cm-md-'))).toEqual([]);
  });

  it.each<MarkdownEditorMode>(['rich', 'markdown'])('styles bold text with the theme, in %s mode', (mode) => {
    const classes = classesAround(renderEditor(mode), 'this');
    expect(classes).toContain('cm-md-strong');
    expect(classes.filter((name) => !name.startsWith('cm-md-'))).toEqual([]);
  });
});
