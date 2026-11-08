import { useEffect, useState } from 'react';

const STORAGE_KEY = 'hatstand.notes-panel';
const WIDE_WINDOW_PX = 1100;

function readStored(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored === 'open';
  } catch {
    // Without storage, the window size decides.
  }
  return window.innerWidth >= WIDE_WINDOW_PX;
}

export function useNotesPanel(): { open: boolean; toggle: () => void } {
  const [open, setOpen] = useState(readStored);
  const [chosen, setChosen] = useState(false);

  useEffect(() => {
    if (!chosen) return;
    try {
      localStorage.setItem(STORAGE_KEY, open ? 'open' : 'closed');
    } catch {
      return;
    }
  }, [chosen, open]);

  return {
    open,
    toggle: () => {
      setChosen(true);
      setOpen((current) => !current);
    },
  };
}
