import { Plus } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { pasteAsOne, splitPaste } from '../../../shared/inbox-paste';
import type { Company, Idea } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { continueList, indentLines, type TextEdit } from '../lib/list-editing';
import { submitShortcutLabel } from '../lib/shortcuts';
import { plural } from '../lib/text';
import { InboxPreview } from './InboxPreview';

type InboxCaptureProps = {
  companies: Company[];
  companyId: string | null;
  onChanged: () => Promise<void>;
};

const EXAMPLE = '# Fix the login page\n- Reproduce the error';

export function InboxCapture({ companies, companyId, onChanged }: InboxCaptureProps) {
  const [target, setTarget] = useState(companyId ?? companies[0]?.id ?? '');
  const [text, setText] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<TextEdit | null>(null);
  const { error, busy, run } = useAction();
  const ideas = splitPaste(text);
  const asOne = pasteAsOne(text);
  const checklistCount = ideas.reduce((total, idea) => total + (idea.checklist?.length ?? 0), 0);
  const hasMoreThanATitle = ideas.length > 1 || checklistCount > 0 || Boolean(ideas[0]?.description);

  useLayoutEffect(() => {
    if (!pendingSelection.current) return;
    editor.current?.setSelectionRange(pendingSelection.current.selectionStart, pendingSelection.current.selectionEnd);
    pendingSelection.current = null;
  }, [text]);

  const add = (items: Idea[]) =>
    run(async () => {
      await api.addIdeas(target, items);
      setText('');
      await onChanged();
    });

  const applyEdit = (event: KeyboardEvent, edit: TextEdit | null) => {
    if (!edit) return;
    event.preventDefault();
    pendingSelection.current = edit;
    setText(edit.value);
  };

  const onEditorKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    const { selectionStart, selectionEnd } = event.currentTarget;
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      form.current?.requestSubmit();
    } else if (event.key === 'Enter' && !event.shiftKey && selectionStart === selectionEnd) {
      applyEdit(event, continueList(text, selectionStart));
    } else if (event.key === 'Tab') {
      applyEdit(event, indentLines(text, selectionStart, selectionEnd, event.shiftKey));
    }
  };

  return (
    <form
      ref={form}
      className="inbox-capture"
      onSubmit={(event) => {
        event.preventDefault();
        if (ideas.length > 0 && target && !busy) void add(ideas);
      }}
    >
      {!companyId && (
        <label>
          Client
          <select value={target} onChange={(event) => setTarget(event.target.value)}>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Paste or write what you have in mind
        <textarea ref={editor} autoFocus rows={text ? 5 : 2} value={text} placeholder={EXAMPLE} onChange={(event) => setText(event.target.value)} onKeyDown={onEditorKey} />
      </label>
      <p className="hint">Start a task with # or a dash. A list under a # title, or an indented list, becomes its checklist. A new line alone adds details, not a task. Tab indents a list line.</p>
      {hasMoreThanATitle && <InboxPreview ideas={ideas} />}
      {ideas.length > 0 && (
        <p className="inbox-count" role="status">
          This adds {plural(ideas.length, 'task', 'tasks')} to the inbox{checklistCount > 0 ? `, with ${plural(checklistCount, 'checklist item', 'checklist items')}` : ''}.
        </p>
      )}
      <div className="inbox-capture-actions">
        <button disabled={busy || ideas.length === 0 || !target} title={submitShortcutLabel()}>
          <Plus size={15} />
          {ideas.length > 1 ? `Add ${ideas.length} tasks` : 'Add to inbox'}
        </button>
        {(ideas.length > 1 || checklistCount > 0) && asOne && (
          <button type="button" className="quiet" disabled={busy} onClick={() => void add([asOne])}>
            Keep as one task
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
