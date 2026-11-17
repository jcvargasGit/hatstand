import { useState } from 'react';
import { areaDescriptionPrompt, DEFAULT_DESCRIPTION_INSTRUCTIONS, descriptionInstructionsFor } from '../../../shared/description-instructions';
import type { Subdomain } from '../../../shared/schemas';
import { MarkdownField } from './MarkdownField';

type AreaDescriptionPromptProps = {
  area: Subdomain;
  disabled?: boolean;
  /** Receives the prompt of the area, or nothing when the area goes back to the default. */
  onSave: (descriptionPrompt: string | undefined) => void;
};

export function AreaDescriptionPrompt({ area, disabled = false, onSave }: AreaDescriptionPromptProps) {
  const [prompt, setPrompt] = useState(descriptionInstructionsFor(area));
  const ownPrompt = area.descriptionPrompt !== undefined;

  return (
    <section className="overview-card" aria-label="Prompt to improve descriptions">
      <div className="stacked-field">
        <span>Prompt to improve descriptions</span>
        <p className="hint">
          What "Improve description" starts with for the tasks of this area. You can still change it each time. {ownPrompt ? 'This area has its own prompt.' : 'This area uses the default prompt.'}
        </p>
        <MarkdownField
          label="Prompt to improve descriptions"
          rows={6}
          value={prompt}
          onChange={setPrompt}
          onCommit={(text) => {
            const next = areaDescriptionPrompt(text);
            setPrompt(next ?? DEFAULT_DESCRIPTION_INSTRUCTIONS);
            if (next !== area.descriptionPrompt) onSave(next);
          }}
        />
        <div className="inline-form">
          <button
            type="button"
            className="quiet"
            disabled={disabled || !ownPrompt}
            onClick={() => {
              setPrompt(DEFAULT_DESCRIPTION_INSTRUCTIONS);
              onSave(undefined);
            }}
          >
            Use the default
          </button>
        </div>
      </div>
    </section>
  );
}
