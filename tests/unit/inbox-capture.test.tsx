// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdeaRow } from '../../src/renderer/src/components/IdeaRow';
import { InboxCapture } from '../../src/renderer/src/components/InboxCapture';
import { continueList, indentLines } from '../../src/renderer/src/lib/list-editing';
import { companySchema, taskSchema } from '../../src/shared/schemas';
import type { Bridge } from '../../src/shared/api';

const invoke = vi.fn(async () => undefined);
const company = companySchema.parse({ id: 'c', name: 'Client', color: '#5BB8A6' });
const task = taskSchema.parse({ id: 't', companyId: 'c', title: 'Fix it', status: 'idea', createdAt: 'x', updatedAt: 'x' });

beforeEach(() => {
  invoke.mockClear();
  window.hatstand = { invoke, on: () => () => {} } as unknown as Bridge;
});
afterEach(cleanup);

const renderCapture = () => {
  const onChanged = vi.fn(async () => undefined);
  render(<InboxCapture companies={[company]} companyId="c" onChanged={onChanged} />);
  return { onChanged, box: screen.getByLabelText<HTMLTextAreaElement>('Paste or write what you have in mind') };
};

describe('writing in the backlog', () => {
  it('shows what will be added as you write', () => {
    const { box } = renderCapture();
    expect(screen.queryByRole('list', { name: 'Tasks to add' })).toBeNull();
    fireEvent.change(box, { target: { value: '# Fix the login\n- Reproduce it\n- Write a test\n# Review' } });
    const checklist = screen.getByRole('list', { name: 'Checklist of Fix the login' });
    expect(within(checklist).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Reproduce it', 'Write a test']);
    expect(screen.getByRole('status').textContent).toBe('This adds 2 tasks to the backlog, with 2 checklist items.');
    expect(screen.getByRole('button', { name: 'Add 2 tasks' })).toBeTruthy();
  });

  it('counts one task when new lines only add details', () => {
    const { box } = renderCapture();
    fireEvent.change(box, { target: { value: 'Fix the login\nIt fails on Safari' } });
    expect(screen.getByRole('status').textContent).toBe('This adds 1 task to the backlog.');
    expect(screen.getByRole('list', { name: 'Tasks to add' }).textContent).toContain('It fails on Safari');
  });

  it('adds the task with its checklist and clears the text', async () => {
    const { box, onChanged } = renderCapture();
    fireEvent.change(box, { target: { value: '# Fix the login\n- Reproduce it' } });
    await userEvent.click(screen.getByRole('button', { name: 'Add to backlog' }));
    expect(invoke).toHaveBeenCalledWith('addIdeas', 'c', [{ title: 'Fix the login', description: '', checklist: ['Reproduce it'] }]);
    expect(onChanged).toHaveBeenCalled();
    expect(box.value).toBe('');
  });

  it('adds with the keyboard, and not when there is nothing to add', async () => {
    const { box } = renderCapture();
    box.focus();
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: '- One' } });
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(invoke).toHaveBeenCalledWith('addIdeas', 'c', [{ title: 'One', description: '' }]);
  });

  it('continues a list on Enter and indents it with Tab', async () => {
    const { box } = renderCapture();
    await userEvent.type(box, '- One{Enter}');
    expect(box.value).toBe('- One\n- ');
    await userEvent.keyboard('{Tab}');
    expect(box.value).toBe('- One\n  - ');
    expect(document.activeElement).toBe(box);
    await userEvent.keyboard('Sub');
    expect(box.value).toBe('- One\n  - Sub');
  });

  it('lets Tab leave the box when the line is not a list', async () => {
    const { box } = renderCapture();
    await userEvent.type(box, 'Plain');
    await userEvent.keyboard('{Tab}');
    expect(box.value).toBe('Plain');
    expect(document.activeElement).not.toBe(box);
  });
});

describe('editing list lines', () => {
  it('continues numbers and checkboxes at the same indentation', () => {
    expect(continueList('  3. Three', 10)?.value).toBe('  3. Three\n  4. ');
    expect(continueList('- [x] Done', 10)?.value).toBe('- [x] Done\n- [ ] ');
  });

  it('ends the list when Enter is pressed on an empty item', () => {
    expect(continueList('- One\n- ', 8)).toEqual({ value: '- One\n', selectionStart: 6, selectionEnd: 6 });
  });

  it('leaves lines that are not lists alone', () => {
    expect(continueList('# Title', 7)).toBeNull();
    expect(indentLines('Plain', 0, 0, false)).toBeNull();
  });

  it('indents and outdents every selected line and keeps the selection', () => {
    expect(indentLines('- a\n- b', 0, 7, false)).toEqual({ value: '  - a\n  - b', selectionStart: 2, selectionEnd: 11 });
    expect(indentLines('  - a\n  - b', 2, 11, true)).toEqual({ value: '- a\n- b', selectionStart: 0, selectionEnd: 7 });
  });

  it('gives Shift+Tab back to the page when nothing can outdent', () => {
    expect(indentLines('- a', 3, 3, true)).toBeNull();
  });
});

describe('a task in the backlog', () => {
  const renderRow = (change: Partial<Parameters<typeof IdeaRow>[0]> = {}) => {
    const props = { task, selected: false, onSelect: vi.fn(), picked: false, onPick: vi.fn(), onChanged: vi.fn(async () => undefined), onMadeTask: vi.fn(), onMoveUp: vi.fn(), onMoveDown: vi.fn(), onDragStart: vi.fn(), onDropHere: vi.fn(), ...change };
    const { container } = render(
      <table>
        <tbody>
          <IdeaRow {...props} />
        </tbody>
      </table>,
    );
    return { ...props, row: container.querySelector<HTMLElement>('.idea-row')! };
  };

  it('moves up and down, and cannot move past the ends', async () => {
    const { onMoveUp } = renderRow({ onMoveDown: undefined });
    await userEvent.click(screen.getByRole('button', { name: 'Move Fix it up' }));
    expect(onMoveUp).toHaveBeenCalled();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Move Fix it down' }).disabled).toBe(true);
  });

  it('saves its priority', async () => {
    renderRow();
    await userEvent.selectOptions(screen.getByLabelText('Priority of Fix it'), 'high');
    expect(invoke).toHaveBeenCalledWith('updateTask', 't', { priority: 'high' });
  });

  it('marks where a dragged task will land, and drops there', () => {
    const { row, onDropHere } = renderRow();
    fireEvent.dragOver(row);
    expect(row.classList.contains('is-over')).toBe(true);
    fireEvent.drop(row);
    expect(row.classList.contains('is-over')).toBe(false);
    expect(onDropHere).toHaveBeenCalled();
  });
});
