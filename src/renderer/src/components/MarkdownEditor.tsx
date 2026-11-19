import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { minimalSetup } from 'codemirror';
import { useEffect, useRef, type RefObject } from 'react';
import { applyMarkdownFormat } from '../lib/markdown-commands';
import { markdownLivePreview, markdownSourceStyles } from '../lib/markdown-live-preview';

export type MarkdownEditorMode = 'rich' | 'markdown';

type MarkdownEditorProps = {
  initialValue: string;
  label: string;
  placeholderText: string;
  mode?: MarkdownEditorMode;
  autoFocus?: boolean;
  editorRef?: RefObject<EditorView | null>;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onLeave: () => void;
};

const modeExtension = (mode: MarkdownEditorMode): Extension => (mode === 'rich' ? markdownLivePreview : [markdownSourceStyles, EditorView.editorAttributes.of({ class: 'cm-md-source' })]);

/**
 * CodeMirror falls back to a highlight style with fixed colors made for a light theme, which cannot be read
 * on a dark one. Registering a style of our own, even an empty one, turns that fallback off, so the text
 * takes its colors from the classes of the live preview.
 */
const noFixedColors = syntaxHighlighting(HighlightStyle.define([]));

const formatKeys = keymap.of([
  { key: 'Mod-b', run: (view) => applyMarkdownFormat(view, 'bold') },
  { key: 'Mod-i', run: (view) => applyMarkdownFormat(view, 'italic') },
  { key: 'Mod-k', run: (view) => applyMarkdownFormat(view, 'link') },
]);

export function MarkdownEditor({ initialValue, label, placeholderText, mode = 'rich', autoFocus = false, editorRef, onChange, onBlur, onLeave }: MarkdownEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const modeSlot = useRef(new Compartment());
  const latest = useRef({ onChange, onBlur, onLeave });
  latest.current = { onChange, onBlur, onLeave };

  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      doc: initialValue,
      extensions: [
        minimalSetup,
        noFixedColors,
        markdown({ base: markdownLanguage }),
        modeSlot.current.of(modeExtension(mode)),
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
        formatKeys,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) latest.current.onChange(update.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          blur: () => {
            latest.current.onBlur?.();
          },
        }),
      ],
    });
    view.current = editor;
    if (editorRef) editorRef.current = editor;
    if (autoFocus) editor.focus();
    return () => {
      editor.destroy();
      view.current = null;
      if (editorRef) editorRef.current = null;
    };
    // The editor owns its text after it opens, so a new initial value must not reset it.
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: modeSlot.current.reconfigure(modeExtension(mode)) });
  }, [mode]);

  return <div className="markdown-editor" ref={host} />;
}
