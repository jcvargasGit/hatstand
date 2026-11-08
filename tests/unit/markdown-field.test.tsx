// @vitest-environment jsdom
import { EditorView } from '@codemirror/view';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MarkdownField } from '../../src/renderer/src/components/MarkdownField';

beforeAll(() => {
  const noRects = () => Object.assign([], { item: () => null });
  Range.prototype.getClientRects = noRects as unknown as Range['getClientRects'];
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

afterEach(cleanup);

function Harness({ initial, onCommit }: { initial: string; onCommit?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <MarkdownField label="About this task" value={value} onChange={setValue} onCommit={onCommit} />
      <button>Elsewhere</button>
      <output aria-label="Saved value">{value}</output>
    </>
  );
}

const editorView = () => {
  const content = screen.getByRole('textbox', { name: 'About this task' });
  const view = EditorView.findFromDOM(content);
  if (!view) throw new Error('No editor');
  return view;
};

const sourceToggle = () => screen.getByRole('button', { name: 'Markdown' });

describe('a Markdown field', () => {
  it('shows the formatted text until the person starts editing', () => {
    render(<Harness initial={'# Plan\n\nShip **today**'} />);
    expect(screen.getByRole('heading', { name: 'Plan' })).toBeTruthy();
    expect(screen.getByText('today').tagName).toBe('STRONG');
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('opens the rich editor with its toolbar when clicked', async () => {
    render(<Harness initial="Ship it" />);
    await userEvent.click(screen.getByRole('button', { name: 'About this task' }));
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeTruthy();
    expect(sourceToggle().getAttribute('aria-pressed')).toBe('false');
    expect(editorView().state.doc.toString()).toBe('Ship it');
    expect(editorView().dom.classList.contains('cm-md-source')).toBe(false);
  });

  it('switches to the Markdown source and keeps the text the same', async () => {
    render(<Harness initial={'## Title\n- item'} />);
    await userEvent.click(screen.getByRole('button', { name: 'About this task' }));
    await userEvent.click(sourceToggle());
    expect(sourceToggle().getAttribute('aria-pressed')).toBe('true');
    expect(editorView().dom.classList.contains('cm-md-source')).toBe(true);
    await userEvent.click(sourceToggle());
    expect(editorView().dom.classList.contains('cm-md-source')).toBe(false);
    expect(editorView().state.doc.toString()).toBe('## Title\n- item');
  });

  it('formats the selection from the toolbar in both modes', async () => {
    render(<Harness initial="ship it" />);
    await userEvent.click(screen.getByRole('button', { name: 'About this task' }));
    editorView().dispatch({ selection: { anchor: 0, head: 4 } });
    await userEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(screen.getByLabelText('Saved value').textContent).toBe('**ship** it');
    await userEvent.click(sourceToggle());
    await userEvent.click(screen.getByRole('button', { name: 'Checklist' }));
    expect(screen.getByLabelText('Saved value').textContent).toBe('- [ ] **ship** it');
  });

  it('saves and shows the formatted text again when focus leaves the field', async () => {
    const onCommit = vi.fn();
    render(<Harness initial="old" onCommit={onCommit} />);
    await userEvent.click(screen.getByRole('button', { name: 'About this task' }));
    editorView().dispatch({ changes: { from: 0, to: 3, insert: '*new*' } });
    fireEvent.blur(editorView().contentDOM, { relatedTarget: screen.getByRole('button', { name: 'Elsewhere' }) });
    expect(onCommit).toHaveBeenCalledWith('*new*');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(screen.getByText('new').tagName).toBe('EM');
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('stays open while focus moves to its own toolbar', async () => {
    const onCommit = vi.fn();
    render(<Harness initial="text" onCommit={onCommit} />);
    await userEvent.click(screen.getByRole('button', { name: 'About this task' }));
    fireEvent.blur(editorView().contentDOM, { relatedTarget: screen.getByRole('button', { name: 'Italic' }) });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('toolbar')).toBeTruthy();
  });

  it('closes with Escape and returns focus to the field', async () => {
    const onCommit = vi.fn();
    render(<Harness initial="text" onCommit={onCommit} />);
    await userEvent.click(screen.getByRole('button', { name: 'About this task' }));
    fireEvent.keyDown(editorView().contentDOM, { key: 'Escape' });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'About this task' }));
  });

  it('opens in the rich editor again after the source was shown', async () => {
    render(<Harness initial="text" />);
    await userEvent.click(screen.getByRole('button', { name: 'About this task' }));
    await userEvent.click(sourceToggle());
    fireEvent.keyDown(editorView().contentDOM, { key: 'Escape' });
    await userEvent.click(screen.getByRole('button', { name: 'About this task' }));
    expect(sourceToggle().getAttribute('aria-pressed')).toBe('false');
  });

  it('opens from the keyboard and shows the placeholder when empty', async () => {
    render(<MarkdownField label="Details" value="" placeholder="What you know so far." onChange={() => {}} />);
    expect(screen.getByText('What you know so far.')).toBeTruthy();
    screen.getByRole('button', { name: 'Details' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('toolbar')).toBeTruthy();
  });
});
