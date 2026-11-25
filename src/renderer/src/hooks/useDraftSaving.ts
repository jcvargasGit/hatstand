import { useCallback, useEffect, useRef, useState } from 'react';
import { hasDraftText, type NewTaskDraft } from '../../../shared/new-task-draft';
import { api } from '../lib/api';

export const DRAFT_SAVE_DELAY_MS = 500;

type DraftSaving = {
  /** The draft in the backlog this form is saved as, or null while it has none. */
  draftId: string | null;
  /** Saves what is pending now, and waits for it. For before the form moves somewhere else. */
  flush: () => Promise<string | null>;
  /** Stops saving, and waits for a save on its way. For when the draft is discarded. */
  stop: () => Promise<string | null>;
  /**
   * For when the form becomes a task: brings the draft it has up to date, so it is in the backlog of the
   * client now chosen, and stops saving. A form that has no draft yet gets none.
   */
  finish: () => Promise<string | null>;
  /** Saves again after a stop, such as when the task could not be created. */
  resume: () => void;
};

/**
 * Keeps the New task form in the backlog as a draft while the person writes, so leaving the form loses nothing.
 * It saves after a pause in the typing and when the form closes. With `enabled` false it does nothing,
 * as for a form opened from a backlog item, which already holds the text.
 */
export function useDraftSaving(form: NewTaskDraft, enabled: boolean): DraftSaving {
  const [draftId, setDraftId] = useState<string | null>(form.draftId ?? null);
  const id = useRef(draftId);
  const latest = useRef(form);
  const saved = useRef(form.draftId ? JSON.stringify({ ...form, draftId: undefined }) : null);
  const inFlight = useRef<Promise<unknown>>(Promise.resolve());
  const stopped = useRef(!enabled);
  latest.current = form;

  const save = useCallback((): Promise<string | null> => {
    const next = inFlight.current.then(async () => {
      if (stopped.current) return id.current;
      const current = { ...latest.current, draftId: undefined };
      const text = JSON.stringify(current);
      if (text === saved.current || (!id.current && !hasDraftText(current))) return id.current;
      id.current = (await api.saveTaskDraft(id.current, current)) ?? null;
      saved.current = text;
      setDraftId(id.current);
      return id.current;
    });
    inFlight.current = next.catch(() => undefined);
    return next;
  }, []);

  const serialized = JSON.stringify({ ...form, draftId: undefined });
  useEffect(() => {
    if (stopped.current) return;
    const timer = setTimeout(() => void save().catch(() => undefined), DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [serialized, save]);

  useEffect(
    () => () => {
      void save().catch(() => undefined);
    },
    [save],
  );

  const stop = useCallback(async () => {
    stopped.current = true;
    await inFlight.current;
    return id.current;
  }, []);

  const finish = useCallback(async () => {
    await inFlight.current;
    const current = id.current ? await save() : null;
    stopped.current = true;
    return current;
  }, [save]);

  const resume = useCallback(() => {
    stopped.current = !enabled;
  }, [enabled]);

  return { draftId, flush: save, stop, finish, resume };
}
