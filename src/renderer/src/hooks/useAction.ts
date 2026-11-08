import { useCallback, useState } from 'react';
import { errorMessage } from '../lib/api';

export function useAction(): {
  error: string | null;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
} {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  return { error, busy, run };
}
