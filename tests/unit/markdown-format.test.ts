import { describe, expect, it } from 'vitest';
import { insertLink, toggleInline, toggleLinePrefix, type FormatEdit } from '../../src/renderer/src/lib/markdown-format';

const apply = (text: string, edit: FormatEdit) => ({
  text: text.slice(0, edit.from) + edit.insert + text.slice(edit.to),
  selected: (text.slice(0, edit.from) + edit.insert + text.slice(edit.to)).slice(edit.selectionFrom, edit.selectionTo),
});

describe('inline formats', () => {
  it('wraps the selected words in bold and keeps them selected', () => {
    expect(apply('make it bold', toggleInline('make it bold', 8, 12, 'bold'))).toEqual({ text: 'make it **bold**', selected: 'bold' });
  });

  it('removes the marks when the selection is already bold', () => {
    expect(apply('a **b** c', toggleInline('a **b** c', 4, 5, 'bold'))).toEqual({ text: 'a b c', selected: 'b' });
  });

  it('puts the cursor between the marks when nothing is selected', () => {
    const edit = toggleInline('x', 1, 1, 'code');
    expect(apply('x', edit).text).toBe('x``');
    expect([edit.selectionFrom, edit.selectionTo]).toEqual([2, 2]);
  });

  it('adds italic inside bold text instead of breaking the bold marks', () => {
    expect(apply('**b**', toggleInline('**b**', 2, 3, 'italic')).text).toBe('***b***');
  });
});

describe('links', () => {
  it('uses the selection as the label and selects the address to type over', () => {
    expect(apply('see docs', insertLink('see docs', 4, 8))).toEqual({ text: 'see [docs](https://)', selected: 'https://' });
  });

  it('writes a placeholder label when nothing is selected', () => {
    expect(apply('', insertLink('', 0, 0)).text).toBe('[link](https://)');
  });
});

describe('line formats', () => {
  it('turns every selected line into a checklist item', () => {
    expect(apply('one\ntwo\nthree', toggleLinePrefix('one\ntwo\nthree', 1, 5, 'checklist')).text).toBe('- [ ] one\n- [ ] two\nthree');
  });

  it('removes the prefix when every line already has it', () => {
    expect(apply('- a\n- b', toggleLinePrefix('- a\n- b', 0, 7, 'bullet')).text).toBe('a\nb');
  });

  it('replaces another list or heading prefix instead of stacking them', () => {
    expect(apply('- item', toggleLinePrefix('- item', 3, 3, 'numbered')).text).toBe('1. item');
    expect(apply('# Title', toggleLinePrefix('# Title', 3, 3, 'heading')).text).toBe('## Title');
  });

  it('formats only the line with the cursor', () => {
    expect(apply('a\nb\nc', toggleLinePrefix('a\nb\nc', 2, 2, 'heading')).text).toBe('a\n## b\nc');
  });
});
