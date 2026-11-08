import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function useEditorName(): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    void api.detectEditor().then((found) => setName(found ?? null));
  }, []);
  return name;
}
