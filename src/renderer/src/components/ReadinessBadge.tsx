import type { Snapshot } from '../../../shared/api';
import type { Company } from '../../../shared/schemas';
import { useClientReadiness } from '../hooks/useClientReadiness';
import { ProgressBar } from './ProgressBar';

type ReadinessBadgeProps = {
  snapshot: Snapshot;
  company: Company;
  onOpen: () => void;
};

export function ReadinessBadge({ snapshot, company, onOpen }: ReadinessBadgeProps) {
  const { percent } = useClientReadiness(snapshot, company);
  if (percent === 100) return null;
  return (
    <button className="readiness-badge" onClick={onOpen}>
      <span>Finish setup, {percent}% done</span>
      <ProgressBar percent={percent} label="Client setup" />
    </button>
  );
}
