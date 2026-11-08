import type { PullChip } from '../../../shared/review';

export function PullChips({ chips }: { chips: PullChip[] }) {
  return (
    <span className="pull-chips">
      {chips.map((chip) => (
        <span key={chip.text} className={`pull-chip tone-${chip.tone}`}>
          {chip.text}
        </span>
      ))}
    </span>
  );
}
