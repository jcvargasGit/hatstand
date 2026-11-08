import { useState } from 'react';

export function useSelection(): {
  isPicked: (id: string) => boolean;
  pick: (ids: string[], on: boolean) => void;
} {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const pick = (ids: string[], on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  return { isPicked: (id) => picked.has(id), pick };
}
