import { useCallback, useEffect, useRef, useState } from 'react';
import type { SuggestionRequest } from '../../../shared/description-suggestion';
import { api, errorMessage } from '../lib/api';

/** What the person is about to send: the task, the prompt as they left it, and the prompt they started from. */
export type SuggestionDraft = { request: SuggestionRequest; instructions: string; defaults: string };

export type SuggestionState =
  | { phase: 'idle' }
  | { phase: 'loading'; request: SuggestionRequest }
  | ({ phase: 'composing' } & SuggestionDraft)
  | ({ phase: 'working' } & SuggestionDraft)
  | ({ phase: 'ready'; suggestion: string } & SuggestionDraft)
  | ({ phase: 'failed'; request: SuggestionRequest; error: string } & Partial<SuggestionDraft>);

export function useDescriptionSuggestion() {
  const [state, setState] = useState<SuggestionState>({ phase: 'idle' });
  const current = useRef<SuggestionRequest | null>(null);
  const running = useRef<string | null>(null);

  const open = useCallback((request: SuggestionRequest) => {
    current.current = request;
    setState({ phase: 'loading', request });
    api.descriptionInstructions(request.companyId, request.subdomainId).then(
      (defaults) => {
        if (current.current === request) setState({ phase: 'composing', request, instructions: defaults, defaults });
      },
      (caught: unknown) => {
        if (current.current === request) setState({ phase: 'failed', request, error: errorMessage(caught) });
      },
    );
  }, []);

  const compose = useCallback((draft: SuggestionDraft) => {
    current.current = draft.request;
    setState({ phase: 'composing', ...draft });
  }, []);

  const send = useCallback((draft: SuggestionDraft) => {
    const { request, instructions } = draft;
    current.current = request;
    running.current = request.key;
    setState({ phase: 'working', ...draft });
    api.suggestDescription({ ...request, instructions }).then(
      ({ description }) => {
        if (current.current !== request) return;
        running.current = null;
        setState({ phase: 'ready', ...draft, suggestion: description });
      },
      (caught: unknown) => {
        if (current.current !== request) return;
        running.current = null;
        setState({ phase: 'failed', ...draft, error: errorMessage(caught) });
      },
    );
  }, []);

  const stop = useCallback(() => {
    const key = running.current;
    current.current = null;
    running.current = null;
    if (key) void api.cancelDescriptionSuggestion(key);
  }, []);

  const close = useCallback(() => {
    stop();
    setState({ phase: 'idle' });
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { state, open, compose, send, close };
}
