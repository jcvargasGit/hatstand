// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskNotes } from '../../src/renderer/src/components/TaskNotes';
import { terminalKeySequence } from '../../src/renderer/src/lib/terminal-keys';
import { parseTaskNotes } from '../../src/shared/task-notes';

const notes = ['## TL;DR', 'The RFC is drafted.', '', '## Last done', 'Wrote the rollout.', '', '## Pending', 'You review it.', '', '## Status', 'In progress', '', '## Decisions', 'Use a queue.'].join('\n');

afterEach(cleanup);

describe('task notes', () => {
  it('reads the sections the agent keeps', () => {
    expect(parseTaskNotes(notes)).toEqual({ summary: 'The RFC is drafted.', lastDone: 'Wrote the rollout.', pending: 'You review it.', status: 'in progress', details: '## Decisions\nUse a queue.' });
  });

  it('ignores headings inside code', () => {
    const parsed = parseTaskNotes('## Decisions\n```\n## Status\ndone\n```');
    expect(parsed.status).toBeUndefined();
    expect(parsed.details).toContain('## Status');
  });

  it('shows the summary first and keeps the rest folded', () => {
    render(<TaskNotes notes={notes} empty="none" />);
    expect(screen.getByText('The RFC is drafted.')).toBeTruthy();
    expect(screen.getByText('Last done')).toBeTruthy();
    expect(screen.getByText('You review it.')).toBeTruthy();
    expect(screen.getByText('Full notes')).toBeTruthy();
  });

  it('shows older notes as they are', () => {
    render(<TaskNotes notes="Next: reproduce it." empty="none" />);
    expect(screen.getByText('Next: reproduce it.')).toBeTruthy();
    expect(screen.queryByText('Last done')).toBeNull();
  });
});

describe('terminal keys', () => {
  const press = (key: string, change: Partial<KeyboardEvent> = {}) => terminalKeySequence({ key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...change });

  it('turns Shift+Enter into a new line for the agent, and leaves Enter alone', () => {
    expect(press('Enter', { shiftKey: true })).toBe('\x1b\r');
    expect(press('Enter')).toBeNull();
  });

  it('moves and deletes by line with the command key', () => {
    expect(press('ArrowLeft', { metaKey: true })).toBe('\x01');
    expect(press('ArrowRight', { metaKey: true })).toBe('\x05');
    expect(press('Backspace', { metaKey: true })).toBe('\x15');
    expect(press('k', { metaKey: true })).toBeNull();
  });
});
