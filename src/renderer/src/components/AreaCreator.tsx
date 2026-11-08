import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';

type AreaCreatorProps = {
  companyId: string;
  onCreated: (areaId: string) => unknown;
};

export function AreaCreator({ companyId, onCreated }: AreaCreatorProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const { error, busy, run } = useAction();

  const create = () =>
    run(async () => {
      const area = await api.createArea(companyId, name.trim());
      await onCreated(area.id);
    });

  if (!open) {
    return (
      <button type="button" className="quiet area-creator-open" onClick={() => setOpen(true)}>
        <Plus size={14} />
        Create an area
      </button>
    );
  }

  return (
    <div className="area-creator">
      <input
        autoFocus
        aria-label="New area name"
        placeholder="New area name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          if (name.trim()) void create();
        }}
      />
      <button type="button" className="quiet" disabled={busy || !name.trim()} onClick={() => void create()}>
        Add area
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
