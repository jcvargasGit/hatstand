import { useEffect, useState } from 'react';

const STORAGE_KEY = 'hatstand.agent-work-sections';

function readClosed(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export type PanelSections = { isOpen: (id: string) => boolean; toggle: (id: string) => void };

/** Which sections of the panel beside the terminal are folded away. The choice holds for every task, and after a restart. */
export function usePanelSections(): PanelSections {
  const [closed, setClosed] = useState(readClosed);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(closed));
    } catch {
      return;
    }
  }, [closed]);

  return {
    isOpen: (id) => !closed.includes(id),
    toggle: (id) => setClosed((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id])),
  };
}
