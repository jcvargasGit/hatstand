import { Layers, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { Snapshot } from '../../../shared/api';
import type { Company } from '../../../shared/schemas';
import { areaRepositoryIds } from '../../../shared/work-repos';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { plural } from '../lib/text';
import { isFinished } from '../lib/today';

type AreaListProps = {
  snapshot: Snapshot;
  company: Company;
  onChanged: () => Promise<void>;
  onOpenArea: (areaId: string) => void;
  stayAfterAdding?: boolean;
};

export function AreaList({ snapshot, company, onChanged, onOpenArea, stayAfterAdding = false }: AreaListProps) {
  const [name, setName] = useState('');
  const { error, busy, run } = useAction();

  const create = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const area = await api.createArea(company.id, name);
      await onChanged();
      setName('');
      if (!stayAfterAdding) onOpenArea(area.id);
    });
  };

  const openTasks = (areaId: string) => snapshot.tasks.filter((task) => task.subdomainId === areaId && !isFinished(task) && task.status !== 'idea').length;

  return (
    <div className="client-projects">
      {company.subdomains.length === 0 ? (
        <p className="hint">An area is a part of this client&rsquo;s work, such as search or a mobile app. It keeps its own notes, instructions, links, repositories and tasks.</p>
      ) : (
        <ul className="client-project-list">
          {company.subdomains.map((area) => (
            <li key={area.id}>
              <button type="button" className="client-project-open" onClick={() => onOpenArea(area.id)}>
                <Layers size={15} />
                <span>{area.name}</span>
              </button>
              <span className="hint">
                {[area.description, plural(openTasks(area.id), 'open task', 'open tasks'), plural(areaRepositoryIds(company, area.id).length, 'repository', 'repositories')].filter(Boolean).join(', ')}
              </span>
            </li>
          ))}
        </ul>
      )}
      <form className="links-add" onSubmit={create}>
        <input aria-label="New area name" placeholder="New area name" value={name} onChange={(event) => setName(event.target.value)} />
        <button className="quiet" disabled={busy || !name.trim()}>
          <Plus size={14} />
          Add area
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
