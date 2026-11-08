import { useEffect, useState } from 'react';
import { api } from '../lib/api';

const loaded = new Map<string, string | null>();

export function useClientPhoto(companyId: string, savedAt: string | undefined): string | null {
  const key = `${companyId}:${savedAt}`;
  const [photo, setPhoto] = useState(() => loaded.get(key) ?? null);

  useEffect(() => {
    if (!savedAt) {
      setPhoto(null);
      return;
    }
    const known = loaded.get(key);
    if (known !== undefined) {
      setPhoto(known);
      return;
    }
    let active = true;
    void api.readClientPhoto(companyId).then((dataUrl) => {
      loaded.set(key, dataUrl);
      if (active) setPhoto(dataUrl);
    });
    return () => {
      active = false;
    };
  }, [companyId, key, savedAt]);

  return photo;
}
