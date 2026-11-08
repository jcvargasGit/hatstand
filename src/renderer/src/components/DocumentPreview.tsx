import { Bot, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ClientFile } from '../../../shared/api';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { MarkdownView } from './MarkdownView';

type DocumentPreviewProps = {
  companyId: string;
  file: ClientFile;
  freshness: number;
  editorName: string | null;
  onOpenTask: (taskId: string) => Promise<void>;
};

const isMarkdown = (name: string) => /\.mdx?$/i.test(name);

export function DocumentPreview({ companyId, file, freshness, editorName, onOpenTask }: DocumentPreviewProps) {
  const [content, setContent] = useState<string | null>(null);
  const { error, busy, run } = useAction();

  useEffect(() => {
    void run(async () => setContent((await api.readClientFile(companyId, file.path)).content));
  }, [companyId, file.path, freshness, run]);

  return (
    <section className="doc-preview" aria-label={`Preview of ${file.name}`}>
      <header className="doc-preview-bar">
        <strong title={file.path}>{file.name}</strong>
        <button className="quiet" disabled={busy} onClick={() => void run(async () => void (await api.openClientFileInEditor(companyId, file.path)))}>
          <ExternalLink size={14} />
          {editorName ? `Edit in ${editorName}` : 'Open file'}
        </button>
        <button
          className="quiet"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const task = await api.createTask({ companyId, title: `Update ${file.name}`, description: `Review ${file.path} and propose improvements. Keep this client's data out of every repository.` });
              await onOpenTask(task.id);
            })
          }
        >
          <Bot size={14} />
          Ask an agent
        </button>
      </header>
      {error && <p className="error">{error}</p>}
      <div className="doc-preview-body">{content !== null && (isMarkdown(file.name) ? <MarkdownView text={content} /> : <pre>{content}</pre>)}</div>
    </section>
  );
}
