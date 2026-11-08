import { FolderOpen, Plus } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';

type PathPickerProps = {
  kind: 'directory' | 'file';
  label: string;
  browseLabel: string;
  onSelect: (path: string) => Promise<void> | void;
};

export function PathPicker({ kind, label, browseLabel, onSelect }: PathPickerProps) {
  const [typed, setTyped] = useState('');
  const { error, busy, run } = useAction();

  const browse = () =>
    void run(async () => {
      const path = kind === 'directory' ? await api.pickDirectory(label) : await api.pickFile(label);
      if (path) await onSelect(path);
    });

  const addTyped = () =>
    void run(async () => {
      await onSelect(await api.resolvePath(typed, kind));
      setTyped('');
    });

  const submitOnEnter = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (typed.trim()) addTyped();
  };

  return (
    <div className="path-picker">
      <div className="path-picker-row">
        <button className="quiet" type="button" disabled={busy} onClick={browse}>
          <FolderOpen size={15} />
          {browseLabel}
        </button>
        <input
          aria-label={`${label}, full path`}
          placeholder="Or paste the full path"
          spellCheck={false}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={submitOnEnter}
        />
        <button className="quiet" type="button" disabled={busy || !typed.trim()} onClick={addTyped}>
          <Plus size={15} />
          Add path
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
