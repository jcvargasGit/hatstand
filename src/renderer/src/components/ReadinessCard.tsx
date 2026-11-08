import { Check, Circle, CircleAlert } from 'lucide-react';
import type { ClientReadiness, ReadinessItem } from '../../../shared/readiness';
import { ProgressBar } from './ProgressBar';

function goToSection(item: ReadinessItem) {
  document.getElementById(item.section)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function ItemIcon({ item }: { item: ReadinessItem }) {
  if (item.done) return <Check className="readiness-done" size={17} />;
  if (item.level === 'required') return <CircleAlert className="readiness-required" size={17} />;
  return <Circle className="readiness-open" size={17} />;
}

type ItemRowProps = { item: ReadinessItem; onOpen: (item: ReadinessItem) => void };

function ItemRow({ item, onOpen }: ItemRowProps) {
  return (
    <li className={item.done ? 'readiness-item is-done' : 'readiness-item'}>
      <ItemIcon item={item} />
      <span>
        {item.done ? (
          <span className="readiness-label">{item.label}</span>
        ) : (
          <button className="link-button" onClick={() => onOpen(item)}>
            {item.label}
          </button>
        )}
        {!item.done && <small>{item.hint}</small>}
      </span>
    </li>
  );
}

type ReadinessCardProps = {
  readiness: ClientReadiness;
  onOpenItem?: (item: ReadinessItem) => void;
};

export function ReadinessCard({ readiness, onOpenItem = goToSection }: ReadinessCardProps) {
  const { items, percent, canStart } = readiness;
  const main = items.filter((item) => item.level !== 'optional');
  const optional = items.filter((item) => item.level === 'optional');

  return (
    <section className="readiness" aria-label="Client setup">
      <div className="readiness-summary">
        <p className="readiness-percent">{percent}%</p>
        <div className="readiness-status">
          <h2>{percent === 100 ? 'This client is fully set up' : 'Client setup'}</h2>
          <p className="hint">
            {canStart ? 'You can start sessions for this client.' : 'Add a repository or a client folder to start sessions.'}
          </p>
          <ProgressBar percent={percent} label="Client setup" />
        </div>
      </div>
      <ul className="readiness-list">
        {main.map((item) => (
          <ItemRow key={item.id} item={item} onOpen={onOpenItem} />
        ))}
      </ul>
      <div>
        <h3 className="readiness-optional">Optional, not counted</h3>
        <ul className="readiness-list">
          {optional.map((item) => (
            <ItemRow key={item.id} item={item} onOpen={onOpenItem} />
          ))}
        </ul>
      </div>
    </section>
  );
}
