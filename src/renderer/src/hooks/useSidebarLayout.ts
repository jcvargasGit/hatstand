import { useEffect, useState } from 'react';
import { isCommandKey } from '../lib/shortcuts';

const STORAGE_KEY = 'hatstand.sidebar';

type Stored = { collapsed: boolean; closedClients: string[]; needsYouHidden: boolean };

function readStored(): Stored {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const value = (parsed ?? {}) as Partial<Stored>;
    return {
      collapsed: value.collapsed === true,
      closedClients: Array.isArray(value.closedClients) ? value.closedClients.filter((id) => typeof id === 'string') : [],
      needsYouHidden: value.needsYouHidden === true,
    };
  } catch {
    return { collapsed: false, closedClients: [], needsYouHidden: false };
  }
}

export type SidebarLayout = Stored & {
  toggleCollapsed: () => void;
  toggleClient: (companyId: string) => void;
  openClient: (companyId: string) => void;
  toggleNeedsYou: () => void;
};

export function useSidebarLayout(): SidebarLayout {
  const [state, setState] = useState(readStored);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      return;
    }
  }, [state]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isCommandKey(event) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setState((current) => ({ ...current, collapsed: !current.collapsed }));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return {
    ...state,
    toggleCollapsed: () => setState((current) => ({ ...current, collapsed: !current.collapsed })),
    toggleClient: (companyId) =>
      setState((current) => ({
        ...current,
        closedClients: current.closedClients.includes(companyId)
          ? current.closedClients.filter((id) => id !== companyId)
          : [...current.closedClients, companyId],
      })),
    openClient: (companyId) =>
      setState((current) => ({ ...current, closedClients: current.closedClients.filter((id) => id !== companyId) })),
    toggleNeedsYou: () => setState((current) => ({ ...current, needsYouHidden: !current.needsYouHidden })),
  };
}
