import { Wand2 } from 'lucide-react';
import { useState } from 'react';
import type { Company } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { applySuggestions, suggestSubdomains, type SubdomainSuggestion } from '../lib/subdomain-suggestions';
import { plural } from '../lib/text';

type SubdomainSuggestionsProps = {
  company: Company;
  onSave: (company: Company) => Promise<void>;
};

type Preview = { suggestions: SubdomainSuggestion[]; unmatched: number; skipped: string[] };

export function SubdomainSuggestions({ company, onSave }: SubdomainSuggestionsProps) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const { error, busy, run } = useAction();

  if (!company.projects.some((project) => !project.subdomainId && !project.splitByFolder)) return null;

  const chosen = preview?.suggestions.filter((item) => !preview.skipped.includes(item.key) && item.name.trim()) ?? [];

  const rename = (key: string, name: string) =>
    setPreview(
      (current) =>
        current && {
          ...current,
          suggestions: current.suggestions.map((item) => (item.key === key ? { ...item, name } : item)),
        },
    );

  const toggle = (key: string) =>
    setPreview(
      (current) =>
        current && {
          ...current,
          skipped: current.skipped.includes(key) ? current.skipped.filter((item) => item !== key) : [...current.skipped, key],
        },
    );

  const apply = () =>
    run(async () => {
      await onSave(applySuggestions(company, chosen, () => crypto.randomUUID()));
      setPreview(null);
    });

  return (
    <div className="field-block">
      <button className="quiet" onClick={() => setPreview({ ...suggestSubdomains(company), skipped: [] })}>
        <Wand2 size={15} />
        Suggest from repository names
      </button>
      {!preview && (
        <p className="hint">
          Matches repositories to your areas by name, and proposes new areas from words they share. You review it first, and
          repositories you already assigned stay as they are.
        </p>
      )}
      {preview && preview.suggestions.length === 0 && (
        <p className="hint">These names share no useful word. Choose an area for each repository below.</p>
      )}
      {preview && preview.suggestions.length > 0 && (
        <>
          <ul className="suggestion-list">
            {preview.suggestions.map((item) => (
              <li key={item.key}>
                <input
                  type="checkbox"
                  aria-label={`Use ${item.name}`}
                  checked={!preview.skipped.includes(item.key)}
                  onChange={() => toggle(item.key)}
                />
                <div>
                  {item.subdomainId ? (
                    <strong>{item.name}</strong>
                  ) : (
                    <input
                      aria-label={`Name for ${item.projectNames.length} repositories`}
                      value={item.name}
                      onChange={(event) => rename(item.key, event.target.value)}
                    />
                  )}
                  <small>{item.subdomainId ? 'Existing subdomain' : 'New subdomain'}</small>
                  <p className="hint">{item.projectNames.join(', ')}</p>
                </div>
              </li>
            ))}
          </ul>
          {preview.unmatched > 0 && <p className="hint">{plural(preview.unmatched, 'repository', 'repositories')} had no match. Choose those below.</p>}
          <div className="inline-form">
            <button disabled={busy || chosen.length === 0} onClick={() => void apply()}>
              Apply {plural(chosen.length, 'area', 'areas')}
            </button>
            <button className="quiet" onClick={() => setPreview(null)}>
              Cancel
            </button>
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
