import { ExternalLink, Plus, X } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { clientLinkSchema, type ClientLink } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';

type LinksEditorProps = {
  links: ClientLink[];
  suggestions: string[];
  onChange: (links: ClientLink[]) => void;
};

const withScheme = (url: string) => (/^[a-z][a-z0-9+.-]*:/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);

export function LinksEditor({ links, suggestions, onChange }: LinksEditorProps) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [invalid, setInvalid] = useState<string | null>(null);
  const urlField = useRef<HTMLInputElement>(null);
  const { error, run } = useAction();
  const unused = suggestions.filter((suggestion) => !links.some((link) => link.label === suggestion));

  const add = (event: FormEvent) => {
    event.preventDefault();
    const parsed = clientLinkSchema.safeParse({ id: crypto.randomUUID(), label, url: withScheme(url) });
    if (!parsed.success) {
      setInvalid(parsed.error.issues[0]?.message ?? 'Check this link.');
      return;
    }
    setInvalid(null);
    onChange([...links, parsed.data]);
    setLabel('');
    setUrl('');
  };

  return (
    <div className="links-editor">
      {links.length > 0 && (
        <ul className="links-list">
          {links.map((link) => (
            <li key={link.id}>
              <button type="button" className="links-open" title={link.url} onClick={() => void run(() => api.openLink(link.url))}>
                <ExternalLink size={14} />
                <span>{link.label}</span>
              </button>
              <span className="hint links-url">{link.url}</span>
              <button type="button" className="quiet" aria-label={`Remove ${link.label}`} title="Remove" onClick={() => onChange(links.filter((other) => other.id !== link.id))}>
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {unused.length > 0 && (
        <div className="links-suggestions" role="group" aria-label="Suggested links">
          {unused.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="quiet"
              onClick={() => {
                setLabel(suggestion);
                urlField.current?.focus();
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
      <form className="links-add" onSubmit={add}>
        <input aria-label="Link name" placeholder="Name" value={label} onChange={(event) => setLabel(event.target.value)} />
        <input ref={urlField} aria-label="Link address" placeholder="https://" value={url} onChange={(event) => setUrl(event.target.value)} />
        <button className="quiet" disabled={!label.trim() || !url.trim()}>
          <Plus size={14} />
          Add link
        </button>
      </form>
      {(invalid ?? error) && <p className="error">{invalid ?? error}</p>}
    </div>
  );
}
