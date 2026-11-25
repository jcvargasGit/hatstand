import { Flag, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FlagChoice } from '../../../shared/schemas';
import { cleanFlags, DEFAULT_FLAGS, MAX_FLAGS } from '../../../shared/task-flags';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { flagFrom } from '../lib/task-flag';

type FlagsSectionProps = {
  flags: FlagChoice[];
  onChanged: () => Promise<void>;
};

const sameFlags = (first: FlagChoice[], second: FlagChoice[]) => JSON.stringify(first) === JSON.stringify(second);

/** The flags the right-click menu of a task offers: their emoji, their name, and which ones there are. */
export function FlagsSection({ flags, onChanged }: FlagsSectionProps) {
  const { error, busy, run } = useAction();
  const [rows, setRows] = useState(flags);
  const [emoji, setEmoji] = useState('');
  const [name, setName] = useState('');
  const typed = flagFrom(emoji);
  const taken = rows.some((row) => row.emoji === typed);
  const full = rows.length >= MAX_FLAGS;

  useEffect(() => setRows(flags), [flags]);

  const save = (next: FlagChoice[]) => {
    setRows(next);
    const cleaned = cleanFlags(next);
    if (sameFlags(cleaned, flags)) return;
    void run(async () => {
      await api.setFlags(cleaned);
      await onChanged();
    });
  };

  const edit = (index: number, change: Partial<FlagChoice>) => setRows(rows.map((row, position) => (position === index ? { ...row, ...change } : row)));

  const add = () => {
    if (!typed || taken || full) return;
    save([...rows, { emoji: typed, name: name.trim() }]);
    setEmoji('');
    setName('');
  };

  return (
    <section className="settings-section stacked" aria-labelledby="settings-flags">
      <h2 id="settings-flags">
        <Flag size={17} />
        Task flags
      </h2>
      <p className="hint">The emoji you can put on a task from the sidebar, with a right click. The name shows when you point at one. Removing a flag here does not take it off the tasks that have it.</p>
      <ul className="flag-rows">
        {rows.map((row, index) => (
          <li key={index} className="flag-row">
            <input
              className="flag-row-emoji"
              aria-label={`Emoji of flag ${index + 1}`}
              value={row.emoji}
              onChange={(event) => edit(index, { emoji: event.target.value })}
              onBlur={() => save(rows.map((item, position) => (position === index ? { ...item, emoji: flagFrom(item.emoji) || (flags[index]?.emoji ?? '') } : item)))}
            />
            <input aria-label={`Name of ${row.emoji}`} placeholder="Name" maxLength={40} value={row.name} onChange={(event) => edit(index, { name: event.target.value })} onBlur={() => save(rows)} />
            <button type="button" className="quiet icon-button" disabled={busy} aria-label={`Remove ${row.emoji}`} title="Remove this flag" onClick={() => save(rows.filter((_row, position) => position !== index))}>
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flag-row"
        aria-label="New flag"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <input className="flag-row-emoji" aria-label="New emoji" placeholder="🙂" value={emoji} onChange={(event) => setEmoji(event.target.value)} />
        <input aria-label="Name of the new flag" placeholder="Name" maxLength={40} value={name} onChange={(event) => setName(event.target.value)} />
        <button type="submit" className="quiet" disabled={busy || !typed || taken || full} title={full ? `The menu has room for ${MAX_FLAGS} flags.` : taken ? 'This emoji is already in the list.' : undefined}>
          <Plus size={14} />
          Add
        </button>
      </form>
      {!sameFlags(flags, DEFAULT_FLAGS) && (
        <button type="button" className="quiet" disabled={busy} onClick={() => save(DEFAULT_FLAGS)}>
          <RotateCcw size={14} />
          Put back the flags Hatstand starts with
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
