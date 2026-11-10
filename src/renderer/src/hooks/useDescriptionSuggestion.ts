import { useCallback, useEffect, useRef, useState } from 'react';
import type { SuggestionRequest } from '../../../shared/description-suggestion';
import { api, errorMessage } from '../lib/api';

export type SuggestionState =
  | { phase: 'idle' }
  | { phase: 'working'; request: SuggestionRequest }
  | { phase: 'ready'; request: SuggestionRequest; suggestion: string }
  | { phase: 'failed'; request: SuggestionRequest; error: string };

export function useDescriptionSuggestion() {
  const [state, setState] = useState<SuggestionState>({ phase: 'idle' });
  const current = useRef<SuggestionRequest | null>(null);

  const start = useCallback((request: SuggestionRequest) => {
    current.current = request;
    setState({ phase: 'working', request });
    api.suggestDescription(request).then(
      ({ description }) => {
        if (current.current === request) setState({ phase: 'ready', request, suggestion: description });
      },
      (caught: unknown) => {
        if (current.current === request) setState({ phase: 'failed', request, error: errorMessage(caught) });
      },
    );
  }, []);

  const close = useCallback(() => {
    const request = current.current;
    current.current = null;
    setState((previous) => {
      if (previous.phase === 'working' && request) void api.cancelDescriptionSuggestion(request.key);
      return { phase: 'idle' };
    });
  }, []);

  useEffect(
    () => () => {
      const request = current.current;
      current.current = null;
      if (request) void api.cancelDescriptionSuggestion(request.key);
    },
    [],
  );

  return { state, start, close };
}
