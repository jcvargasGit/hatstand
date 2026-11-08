import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { Prec } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { minimalSetup } from 'codemirror';
import { useEffect, useRef } from 'react';
import { markdownLivePreview } from '../lib/markdown-live-preview';

type MarkdownEditorProps = {
  initialValue: string;
  label: string;
  placeholderText: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  onLeave: () => void;
};

export function MarkdownEditor({ initialValue, label, placeholderText, onChange, onBlur, onLeave }: MarkdownEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef({ onChange, onBlur, onLeave });
  latest.current = { onChange, onBlur, onLeave };

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      doc: initialValue,
      extensions: [
        minimalSetup,
        markdown({ base: markdownLanguage }),
        markdownLivePreview,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': label }),
        placeholder(placeholderText),
        Prec.high(
          keymap.of([
            {
              key: 'Escape',
              run: () => {
                latest.current.onLeave();
                return true;
              },
            },
          ]),
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) latest.current.onChange(update.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          blur: () => {
            latest.current.onBlur();
          },
        }),
      ],
    });
    return () => view.destroy();
    // The editor owns its text after it opens, so a new initial value must not reset it.
  }, []);

  return <div className="markdown-editor" ref={host} />;
}
