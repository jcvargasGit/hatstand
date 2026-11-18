import { ExternalLink, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { keyProblemAdvice, keyState, keyStateLabel, shownDay } from '../../../shared/key-status';
import type { KeyInfo } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';

export type KeyRowProps = {
  name: string;
  /** Missing when the client has not saved this key yet. */
  info?: KeyInfo;
  purpose: string;
  /** A value that is not secret, such as an address, can be read while it is typed. */
  isSecret: boolean;
  /** Where to create a new token and what it needs. Only tokens of a known provider have it. */
  renewal?: { url: string | null; permissions: string };
  now: Date;
  onSave: (value: string) => Promise<void>;
  /** Missing when Hatstand knows no provider to ask about this key. */
  onCheck?: () => Promise<void>;
  onDelete: () => Promise<void>;
  /** Only keys Hatstand does not know have a note, because it cannot say what they are for. */
  onNote?: (note: string) => Promise<void>;
};

export function KeyRow({ name, info, purpose, isSecret, renewal, now, onSave, onCheck, onDelete, onNote }: KeyRowProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [note, setNote] = useState(info?.note ?? '');
  const { error, busy, run } = useAction();

  const state = info ? keyState(info, now) : 'unchecked';
  const label = info ? keyStateLabel(info, now) : '';
  const advice = info ? keyProblemAdvice(info, now) : '';

  const save = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await onSave(value);
      setValue('');
      setEditing(false);
      await onCheck?.();
    });
  };

  const stopEditing = () => {
    setValue('');
    setEditing(false);
  };

  const saveNote = () => {
    if (onNote && note.trim() !== (info?.note ?? '')) void run(() => onNote(note));
  };

  return (
    <li className={info ? 'key-row' : 'key-row is-missing'}>
      <div className="key-row-head">
        <code className="key-name">{name}</code>
        {info && label && <span className={`key-state is-${state}`}>{label}</span>}
        {info && !label && onCheck && <span className="key-state">Not checked</span>}
        {!info && <span className="key-state">Not added</span>}
        <span className="key-actions">
          {!editing && (
            <button type="button" className="quiet" aria-label={`${info ? 'Replace' : 'Add'} ${name}`} onClick={() => setEditing(true)}>
              {info ? <RefreshCw size={14} /> : <Plus size={14} />}
              {info ? 'Replace' : 'Add'}
            </button>
          )}
          {info && onCheck && (
            <button type="button" className="quiet" aria-label={`Check ${name}`} disabled={busy} onClick={() => void run(onCheck)}>
              <ShieldCheck size={14} />
              Check
            </button>
          )}
          {info && (
            <button type="button" className="quiet" aria-label={`Delete key ${name}`} disabled={busy} onClick={() => void run(onDelete)}>
              <Trash2 size={14} />
              Delete
            </button>
          )}
        </span>
      </div>
      <p className="hint">{purpose}</p>
      {advice && <p className={state === 'expires-soon' ? 'warning' : 'error'}>{advice}</p>}
      {renewal && (
        <p className="hint">
          {renewal.permissions}{' '}
          {renewal.url && (
            <a href={renewal.url} target="_blank" rel="noreferrer">
              Get a new token <ExternalLink size={12} />
            </a>
          )}
        </p>
      )}
      {info?.savedAt && <p className="hint">Saved on {shownDay(info.savedAt)}.</p>}
      {info && onNote && (
        <input
          className="key-note"
          aria-label={`Note for ${name}`}
          placeholder="What is this key for? Never write the value here."
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onBlur={saveNote}
        />
      )}
      {editing && (
        <form className="inline-form" onSubmit={save}>
          <input
            aria-label={`New value for ${name}`}
            type={isSecret ? 'password' : 'text'}
            placeholder={info ? 'New value' : 'Value'}
            autoComplete="off"
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <button type="submit" disabled={!value || busy}>
            Save
          </button>
          <button type="button" className="quiet" onClick={stopEditing}>
            Cancel
          </button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </li>
  );
}
