import type { EditorView } from '@codemirror/view';
import { RotateCcw, Send } from 'lucide-react';
import { useRef, useState } from 'react';
import { MAX_DESCRIPTION_INSTRUCTIONS } from '../../../shared/description-instructions';
import { applyMarkdownFormat } from '../lib/markdown-commands';
import { MarkdownEditor, type MarkdownEditorMode } from './MarkdownEditor';
import { MarkdownToolbar } from './MarkdownToolbar';

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
  const [mode, setMode] = useState<MarkdownEditorMode>('rich');
  const [resets, setResets] = useState(0);
  const editor = useRef<EditorView | null>(null);
  const sendButton = useRef<HTMLButtonElement>(null);
  const tooLong = text.length > MAX_DESCRIPTION_INSTRUCTIONS;

  return (
    <>
      <div className="suggestion-body">
        <p className="hint">
          The assistant reads the project and follows this prompt to rewrite the description. Add, change or remove instructions for this run. The prompt an area starts with is in its settings.
        </p>
        <div className={`markdown-field is-editing is-${mode} suggestion-prompt`}>
          <MarkdownToolbar mode={mode} onModeChange={setMode} onFormat={(format) => editor.current && applyMarkdownFormat(editor.current, format)} />
          <div className="markdown-field-editor">
            <MarkdownEditor
              key={resets}
              initialValue={text}
              label="Prompt"
              placeholderText="No instructions. The assistant decides how to write the description."
              mode={mode}
              autoFocus
              editorRef={editor}
              onChange={setText}
              onLeave={() => sendButton.current?.focus()}
            />
          </div>
        </div>
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
