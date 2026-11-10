import { Sparkles } from 'lucide-react';
import type { SuggestionRequest } from '../../../shared/description-suggestion';
import { useDescriptionSuggestion } from '../hooks/useDescriptionSuggestion';
import { DescriptionSuggestionDialog } from './DescriptionSuggestionDialog';

type ImproveDescriptionProps = {
  request: SuggestionRequest;
  currentDescription: string;
  disabledReason?: string;
  compact?: boolean;
  onAccept: (description: string) => void;
};

export function ImproveDescription({ request, currentDescription, disabledReason, compact = false, onAccept }: ImproveDescriptionProps) {
  const { state, start, close } = useDescriptionSuggestion();
  const empty = !request.title?.trim() && !request.description?.trim();
  const reason = disabledReason ?? (empty ? 'Write a title or a description first.' : undefined);

  return (
    <>
      <button
        type="button"
        className="quiet improve-description"
        aria-label={compact ? `Improve the description of ${request.title || 'this task'}` : undefined}
        disabled={reason !== undefined || state.phase === 'working'}
        title={reason ?? 'The assistant reads the project and suggests a fuller description. Nothing changes until you accept it.'}
        onClick={() => start(request)}
      >
        <Sparkles size={14} />
        {!compact && 'Improve description'}
      </button>
      {state.phase !== 'idle' && (
        <DescriptionSuggestionDialog
          state={state}
          currentDescription={currentDescription}
          onRetry={() => start({ ...state.request, description: currentDescription })}
          onClose={close}
          onAccept={(description) => {
            close();
            onAccept(description);
          }}
        />
      )}
    </>
  );
}
