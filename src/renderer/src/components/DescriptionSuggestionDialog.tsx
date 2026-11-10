import { Check, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import type { SuggestionState } from '../hooks/useDescriptionSuggestion';
import { MarkdownView } from './MarkdownView';

type DescriptionSuggestionDialogProps = {
  state: Exclude<SuggestionState, { phase: 'idle' }>;
  currentDescription: string;
  onAccept: (description: string) => void;
  onRetry: () => void;
  onClose: () => void;
};

export function DescriptionSuggestionDialog({ state, currentDescription, onAccept, onRetry, onClose }: DescriptionSuggestionDialogProps) {
  const [showOriginal, setShowOriginal] = useState(false);
  const changedMeanwhile = currentDescription !== state.request.description;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    event.preventDefault();
    onClose();
  };

  return (
    <div className="palette-backdrop suggestion-backdrop" onMouseDown={onClose}>
      <div className="suggestion-dialog" role="dialog" aria-modal="true" aria-label="Suggested description" onKeyDown={onKeyDown} onMouseDown={(event) => event.stopPropagation()}>
        <div className="suggestion-head">
          <h3>Suggested description</h3>
          <button type="button" className="quiet" aria-label="Close" title="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="suggestion-body">
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
          {state.phase !== 'working' && (
            <button type="button" className="quiet" onClick={onRetry}>
              <RotateCcw size={14} />
              Try again
            </button>
          )}
          <button type="button" className="quiet" autoFocus={state.phase === 'working'} onClick={onClose}>
            {state.phase === 'working' ? 'Cancel' : 'Discard'}
          </button>
        </div>
      </div>
    </div>
  );
}
