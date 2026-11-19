import { RotateCcw, Send } from 'lucide-react';
import { useRef, useState } from 'react';
import { MAX_DESCRIPTION_INSTRUCTIONS } from '../../../shared/description-instructions';
import { MarkdownComposer } from './MarkdownComposer';

type DescriptionPromptStepProps = {
  instructions: string;
  defaults: string;
  onSend: (instructions: string) => void;
  onClose: () => void;
};

/**
 * The prompt stays open for editing the whole time. A field that opens on click would change its height
 * when the focus leaves it, and move the Send button away from under the pointer.
 */
export function DescriptionPromptStep({ instructions, defaults, onSend, onClose }: DescriptionPromptStepProps) {
  const [text, setText] = useState(instructions);
  const [resets, setResets] = useState(0);
  const sendButton = useRef<HTMLButtonElement>(null);
  const tooLong = text.length > MAX_DESCRIPTION_INSTRUCTIONS;

  return (
    <>
      <div className="suggestion-body">
        <p className="hint">
          The assistant reads the project and follows this prompt to rewrite the description. Add, change or remove instructions for this run. The prompt an area starts with is in its settings.
        </p>
        <MarkdownComposer
          key={resets}
          className="suggestion-prompt"
          initialValue={text}
          label="Prompt"
          placeholderText="No instructions. The assistant decides how to write the description."
          autoFocus
          onChange={setText}
          onLeave={() => sendButton.current?.focus()}
        />
        {tooLong && (
          <p className="error" role="alert">
            Keep the prompt under {MAX_DESCRIPTION_INSTRUCTIONS} characters.
          </p>
        )}
      </div>
      <div className="inline-form suggestion-actions">
        <button type="button" ref={sendButton} disabled={tooLong} onClick={() => onSend(text)}>
          <Send size={14} />
          Send
        </button>
        <button
          type="button"
          className="quiet"
          disabled={text === defaults}
          onClick={() => {
            setText(defaults);
            setResets((count) => count + 1);
          }}
        >
          <RotateCcw size={14} />
          Reset to default
        </button>
        <button type="button" className="quiet" onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  );
}
