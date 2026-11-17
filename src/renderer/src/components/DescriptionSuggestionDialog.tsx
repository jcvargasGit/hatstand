import { Check, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import type { SuggestionState } from '../hooks/useDescriptionSuggestion';
import { DescriptionPromptStep } from './DescriptionPromptStep';
import { MarkdownView } from './MarkdownView';

type DescriptionSuggestionDialogProps = {
  state: Exclude<SuggestionState, { phase: 'idle' }>;
  currentDescription: string;
  onSend: (instructions: string) => void;
  onAccept: (description: string) => void;
  onRetry: () => void;
  onClose: () => void;
};

export function DescriptionSuggestionDialog({ state, currentDescription, onSend, onAccept, onRetry, onClose }: DescriptionSuggestionDialogProps) {
  const [showOriginal, setShowOriginal] = useState(false);
  const changedMeanwhile = currentDescription !== state.request.description;
  const asking = state.phase === 'loading' || state.phase === 'composing';
  const title = asking ? 'Improve description' : 'Suggested description';

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    // The prompt editor already used this Escape to stop editing.
    if (event.defaultPrevented) return;
    event.preventDefault();
    onClose();
  };

  return (
    <div className="palette-backdrop suggestion-backdrop" onMouseDown={onClose}>
      <div className="suggestion-dialog" role="dialog" aria-modal="true" aria-label={title} onKeyDown={onKeyDown} onMouseDown={(event) => event.stopPropagation()}>
        <div className="suggestion-head">
          <h3>{title}</h3>
          <button type="button" className="quiet" aria-label="Close" title="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {state.phase === 'composing' ? (
          <DescriptionPromptStep instructions={state.instructions} defaults={state.defaults} onSend={onSend} onClose={onClose} />
        ) : (
          <>
            <div className="suggestion-body">
              {state.phase === 'loading' && (
                <p className="suggestion-working" role="status">
                  <LoaderCircle size={16} className="spin" />
                  Getting the prompt.
                </p>
              )}
              {state.phase === 'working' && (
                <p className="suggestion-working" role="status">
                  <LoaderCircle size={16} className="spin" />
                  Reading the project and writing a better description. This can take a few minutes.
                </p>
              )}
              {state.phase === 'failed' && (
                <p className="error" role="alert">
                  {state.error}
                </p>
              )}
              {state.phase === 'ready' && (
                <>
                  {changedMeanwhile && (
                    <p className="warning-text" role="note">
                      The description changed after you asked for this suggestion. Accepting replaces your latest text.
                    </p>
                  )}
                  <div className="suggestion-text" aria-label={showOriginal ? 'Current description' : 'Suggestion'}>
                    <MarkdownView text={showOriginal ? currentDescription || '_Empty._' : state.suggestion} />
                  </div>
                </>
              )}
            </div>

            <div className="inline-form suggestion-actions">
              {state.phase === 'ready' && (
                <>
                  <button type="button" autoFocus onClick={() => onAccept(state.suggestion)}>
                    <Check size={14} />
                    Accept
                  </button>
                  <button type="button" className="quiet" aria-pressed={showOriginal} onClick={() => setShowOriginal((shown) => !shown)}>
                    {showOriginal ? 'Show suggestion' : 'Show current'}
                  </button>
                </>
              )}
              {(state.phase === 'ready' || state.phase === 'failed') && (
                <button type="button" className="quiet" title="Go back to the prompt and send it again" onClick={onRetry}>
                  <RotateCcw size={14} />
                  Try again
                </button>
              )}
              <button type="button" className="quiet" autoFocus={state.phase === 'working' || state.phase === 'loading'} onClick={onClose}>
                {state.phase === 'working' || state.phase === 'loading' ? 'Cancel' : 'Discard'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
