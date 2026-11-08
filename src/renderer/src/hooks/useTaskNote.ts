import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';

const SAVE_DELAY_MS = 500;

export type TaskNoteState = {
  initialNote: string | null;
  error: string | null;
  change: (note: string) => void;
  flush: () => void;
};

export function useTaskNote(taskId: string): TaskNoteState {
  const [initialNote, setInitialNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unsaved = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const note = unsaved.current;
    if (note === null) return;
    unsaved.current = null;
    api.saveTaskNote(taskId, note).then(
      () => setError(null),
      (caught: unknown) => setError(errorMessage(caught)),
    );
  }, [taskId]);

  const change = useCallback(
    (note: string) => {
      unsaved.current = note;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  useEffect(() => {
    let active = true;
    api.readTaskNote(taskId).then(
      (note) => {
        if (active) setInitialNote(note);
      },
      (caught: unknown) => {
        if (active) setError(errorMessage(caught));
      },
    );
    return () => {
      active = false;
      flush();
    };
  }, [taskId, flush]);

  return { initialNote, error, change, flush };
}
