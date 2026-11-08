import { useEffect, useRef } from 'react';
import { isCommandKey, shortcutKey } from '../lib/shortcuts';

export function useShortcuts(handlers: Record<string, () => void>): void {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isCommandKey(event)) return;
      const handler = latest.current[shortcutKey(event)];
      if (!handler) return;
      event.preventDefault();
      event.stopPropagation();
      handler();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}
