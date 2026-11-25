import { useMemo, type ReactNode } from 'react';
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown';
import { pathFromLink } from '../lib/path-links';

type MarkdownViewProps = {
  text: string;
  /** Opens a file of this computer. With it, a link or inline code that is an absolute path can be clicked. */
  onOpenPath?: (path: string) => void;
};

const keepFileLinks = (url: string) => (url.startsWith('file://') ? url : defaultUrlTransform(url));

function WebLink({ href, children }: { href?: string; children?: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

const imageAsText: Components['img'] = ({ alt }) => <span>{alt}</span>;

const READ_ONLY: Components = { a: ({ href, children }) => <WebLink href={href}>{children}</WebLink>, img: imageAsText };

/** The same view, where a link or inline code that names a file opens it. Built once per handler, so a click is never lost to a new render. */
function withFileLinks(onOpenPath: (path: string) => void): Components {
  return {
    img: imageAsText,
    a: ({ href, children }) => {
      const path = pathFromLink(href);
      if (!path) return <WebLink href={href}>{children}</WebLink>;
      return (
        <button type="button" className="link-button" title={`Open ${path}`} onClick={() => onOpenPath(path)}>
          {children}
        </button>
      );
    },
    code: ({ children, className }) => {
      const path = !className && typeof children === 'string' ? pathFromLink(children) : null;
      if (!path) return <code className={className}>{children}</code>;
      return (
        <button type="button" className="link-button path-link" title={`Open ${path}`} onClick={() => onOpenPath(path)}>
          <code>{children}</code>
        </button>
      );
    },
  };
}

export function MarkdownView({ text, onOpenPath }: MarkdownViewProps) {
  const components = useMemo(() => (onOpenPath ? withFileLinks(onOpenPath) : READ_ONLY), [onOpenPath]);
  return (
    <div className="file-preview">
      <Markdown urlTransform={onOpenPath ? keepFileLinks : defaultUrlTransform} components={components}>
        {text}
      </Markdown>
    </div>
  );
}
