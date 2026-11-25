import { useSyncExternalStore } from 'react';
import { suggestions, type SuggestionEntry } from '../lib/suggestion-store';

export type { SuggestionDraft, SuggestionState } from '../lib/suggestion-store';

/** The suggestion asked for under a key, which outlives the component that asked for it. */
export function useDescriptionSuggestion(key: string): SuggestionEntry {
  return useSyncExternalStore(suggestions.subscribe, () => suggestions.read(key));
}
