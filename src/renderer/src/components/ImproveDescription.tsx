import { LoaderCircle, Sparkles } from 'lucide-react';
import type { SuggestionRequest } from '../../../shared/description-suggestion';
import { useDescriptionSuggestion } from '../hooks/useDescriptionSuggestion';
import { suggestions } from '../lib/suggestion-store';
import { DescriptionSuggestionDialog } from './DescriptionSuggestionDialog';

type ImproveDescriptionProps = {
  request: SuggestionRequest;
  currentDescription: string;
  disabledReason?: string;
  compact?: boolean;
  onAccept: (description: string) => void;
};

const ASK = 'Write a prompt, and the assistant reads the project and suggests a fuller description. Nothing changes until you accept it.';
const WORKING = 'The assistant is writing a suggestion. It continues while you do something else. Click to see it.';
const READY = 'The suggestion is ready. Click to read it and accept it, or discard it.';

export function ImproveDescription({ request, currentDescription, disabledReason, compact = false, onAccept }: ImproveDescriptionProps) {
  const { state, shown } = useDescriptionSuggestion(request.key);
  const empty = !request.title?.trim() && !request.description?.trim();
  const waiting = state.phase === 'working' || state.phase === 'ready';
  const reason = waiting ? undefined : (disabledReason ?? (empty ? 'Write a title or a description first.' : undefined));
  const what = request.title || 'this task';
  const label = state.phase === 'working' ? 'Writing suggestion' : state.phase === 'ready' ? 'See suggestion' : 'Improve description';
  const compactLabel = state.phase === 'working' ? `Writing a suggestion for ${what}. Show it` : state.phase === 'ready' ? `See the suggestion for ${what}` : `Improve the description of ${what}`;

  return (
    <>
      <button
        type="button"
        className={state.phase === 'ready' ? 'quiet improve-description is-ready' : 'quiet improve-description'}
        aria-label={compact ? compactLabel : undefined}
        aria-busy={state.phase === 'working'}
        disabled={reason !== undefined || shown}
        title={reason ?? (state.phase === 'working' ? WORKING : state.phase === 'ready' ? READY : ASK)}
        onClick={() => (waiting ? suggestions.show(request.key) : suggestions.open(request))}
      >
        {state.phase === 'working' ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}
        {!compact && label}
      </button>
      {shown && state.phase !== 'idle' && (
        <DescriptionSuggestionDialog
          state={state}
          currentDescription={currentDescription}
          onSend={(instructions) => state.phase === 'composing' && suggestions.send({ request: state.request, instructions, defaults: state.defaults })}
          onRetry={() => {
            const latest = { ...state.request, description: currentDescription };
            if (state.phase === 'loading' || state.instructions === undefined || state.defaults === undefined) return suggestions.open(latest);
            suggestions.compose({ request: latest, instructions: state.instructions, defaults: state.defaults });
          }}
          onHide={() => suggestions.hide(request.key)}
          onDrop={() => suggestions.drop(request.key)}
          onAccept={(description) => {
            suggestions.drop(request.key);
            onAccept(description);
          }}
        />
      )}
    </>
  );
}
