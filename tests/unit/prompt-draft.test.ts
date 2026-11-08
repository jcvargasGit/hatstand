import { describe, expect, it } from 'vitest';
import { draftLengthAfter } from '../../src/main/agents/prompt-draft';

describe('draftLengthAfter', () => {
  it('counts what the person types, and what they erase', () => {
    expect(draftLengthAfter(0, 'abc')).toBe(3);
    expect(draftLengthAfter(3, '\x7f')).toBe(2);
    expect(draftLengthAfter(0, '\x7f')).toBe(0);
    expect(draftLengthAfter(0, 'é😀')).toBe(2);
  });

  it.each([
    ['Enter', '\r'],
    ['Ctrl+C', '\x03'],
    ['Ctrl+U', '\x15'],
  ])('empties the box with %s', (_name, key) => {
    expect(draftLengthAfter(5, key)).toBe(0);
  });

  it('keeps the text with Shift+Enter and Ctrl+J, which only add a line', () => {
    expect(draftLengthAfter(5, '\x1b\r')).toBe(6);
    expect(draftLengthAfter(5, '\n')).toBe(6);
  });

  it('counts a paste as text, even with line breaks inside', () => {
    expect(draftLengthAfter(0, '\x1b[200~one\rtwo\x1b[201~')).toBe(7);
    expect(draftLengthAfter(0, '\x1b[200~\x1b[201~')).toBe(0);
  });

  it('treats text brought back with the up arrow as unknown, until the box is emptied', () => {
    for (const up of ['\x1b[A', '\x1bOA']) {
      const recalled = draftLengthAfter(0, up);
      expect(recalled).toBeGreaterThan(0);
      expect(draftLengthAfter(recalled, '\x7f\x7f\x7f')).toBeGreaterThan(0);
      expect(draftLengthAfter(recalled, '\r')).toBe(0);
    }
  });

  it.each([
    ['focus in', '\x1b[I'],
    ['focus out', '\x1b[O'],
    ['left arrow', '\x1b[D'],
    ['application left arrow', '\x1bOD'],
    ['a mouse report', '\x1b[<0;10;5M'],
    ['Escape', '\x1b'],
    ['Alt+b', '\x1bb'],
    ['Tab', '\t'],
    ['Ctrl+A', '\x01'],
  ])('does not count %s as text', (_name, key) => {
    expect(draftLengthAfter(2, key)).toBe(2);
  });

  it('follows several keys in one chunk', () => {
    expect(draftLengthAfter(0, 'hello\rabc')).toBe(3);
  });
});
