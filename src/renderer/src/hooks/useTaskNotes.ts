import { useEffect, useState } from 'react';
import { api } from '../lib/api';

const REFRESH_MS = 3000;

export function useTaskNotes(taskId: string): string {
  const [notes, setNotes] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      const saved = await api.readNotes(taskId);
      if (active) setNotes(saved);
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [taskId]);

  return notes;
}
