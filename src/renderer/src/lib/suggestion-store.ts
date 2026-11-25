import type { SuggestionRequest } from '../../../shared/description-suggestion';
import { api, errorMessage } from './api';

/** What the person is about to send: the task, the prompt as they left it, and the prompt they started from. */
export type SuggestionDraft = { request: SuggestionRequest; instructions: string; defaults: string };

export type SuggestionState =
  | { phase: 'idle' }
  | { phase: 'loading'; request: SuggestionRequest }
  | ({ phase: 'composing' } & SuggestionDraft)
  | ({ phase: 'working' } & SuggestionDraft)
  | ({ phase: 'ready'; suggestion: string } & SuggestionDraft)
  | ({ phase: 'failed'; request: SuggestionRequest; error: string } & Partial<SuggestionDraft>);

/** A suggestion and whether its dialog is on screen. A hidden one keeps running, and waits for the person to look at it. */
export type SuggestionEntry = { state: SuggestionState; shown: boolean };

const IDLE: SuggestionEntry = { state: { phase: 'idle' }, shown: false };

/**
 * The suggestions asked for, by the key of their request. They live outside the components, so closing
 * the dialog or leaving the page does not stop one that is being written.
 */
const entries = new Map<string, SuggestionEntry>();
const listeners = new Set<() => void>();

function set(key: string, entry: SuggestionEntry | null): void {
  if (entry) entries.set(key, entry);
  else entries.delete(key);
  listeners.forEach((listener) => listener());
}

/** Whether the entry of a key is still the one a request started from, so a late answer never replaces a newer state. */
const isCurrent = (key: string, state: SuggestionState) => entries.get(key)?.state === state;

export const suggestions = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  read: (key: string): SuggestionEntry => entries.get(key) ?? IDLE,

  /** Opens the dialog on the prompt of the client and area, before anything runs. */
  open(request: SuggestionRequest): void {
    const loading: SuggestionState = { phase: 'loading', request };
    set(request.key, { state: loading, shown: true });
    api.descriptionInstructions(request.companyId, request.subdomainId).then(
      (defaults) => {
        if (isCurrent(request.key, loading)) set(request.key, { state: { phase: 'composing', request, instructions: defaults, defaults }, shown: true });
      },
      (caught: unknown) => {
        if (isCurrent(request.key, loading)) set(request.key, { state: { phase: 'failed', request, error: errorMessage(caught) }, shown: true });
      },
    );
  },

  compose(draft: SuggestionDraft): void {
    set(draft.request.key, { state: { phase: 'composing', ...draft }, shown: true });
  },

  send(draft: SuggestionDraft): void {
    const { request, instructions } = draft;
    const working: SuggestionState = { phase: 'working', ...draft };
    set(request.key, { state: working, shown: true });
    const finish = (state: SuggestionState) => {
      if (isCurrent(request.key, working)) set(request.key, { state, shown: entries.get(request.key)?.shown ?? false });
    };
    api.suggestDescription({ ...request, instructions }).then(
      ({ description }) => finish({ phase: 'ready', ...draft, suggestion: description }),
      (caught: unknown) => finish({ phase: 'failed', ...draft, error: errorMessage(caught) }),
    );
  },

  /** Closes the dialog. A suggestion being written keeps running, and a finished one waits; anything else has nothing to keep. */
  hide(key: string): void {
    const entry = entries.get(key);
    if (!entry) return;
    const keeps = entry.state.phase === 'working' || entry.state.phase === 'ready';
    set(key, keeps ? { ...entry, shown: false } : null);
  },

  show(key: string): void {
    const entry = entries.get(key);
    if (entry) set(key, { ...entry, shown: true });
  },

  /** Forgets the suggestion of a key, and stops the assistant if it is still writing it. */
  drop(key: string): void {
    const entry = entries.get(key);
    if (!entry) return;
    set(key, null);
    if (entry.state.phase === 'working') void api.cancelDescriptionSuggestion(key);
  },

  /** For tests: forgets every suggestion, without telling the assistant. */
  reset(): void {
    entries.clear();
    listeners.forEach((listener) => listener());
  },
};
