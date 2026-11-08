import { Check, Eye, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { GitIdentityPreview, GitIdentityStatus } from '../../../shared/api';
import { gitIdentityInputSchema, type Company } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';

type GitIdentityStepProps = {
  company: Company;
  onChanged: () => Promise<void>;
};

const EMPTY = { name: '', email: '', githubUser: '', folder: '' };

export function GitIdentityStep({ company, onChanged }: GitIdentityStepProps) {
  const [form, setForm] = useState(EMPTY);
  const [status, setStatus] = useState<GitIdentityStatus | null>(null);
  const [preview, setPreview] = useState<GitIdentityPreview | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const { error, busy, run } = useAction();

  useEffect(() => {
    void run(async () => {
      const current = await api.gitIdentityStatus(company.id);
      setStatus(current);
      setForm(current.suggested);
    });
  }, [company.id, run]);

  const field = (key: keyof typeof EMPTY, label: string, hint?: string) => (
    <label className="stacked-field">
      {label}
      <input
        value={form[key]}
        onChange={(event) => {
          setPreview(null);
          setForm({ ...form, [key]: event.target.value });
        }}
      />
      {hint && <small className="hint">{hint}</small>}
    </label>
  );

  const showPreview = () => {
    const parsed = gitIdentityInputSchema.safeParse(form);
    if (!parsed.success) {
      setInvalid(parsed.error.issues[0]?.message ?? 'Check these fields.');
      return;
    }
    setInvalid(null);
    void run(async () => setPreview(await api.previewGitIdentity(company.id, parsed.data)));
  };

  const apply = () =>
    run(async () => {
      setStatus(await api.applyGitIdentity(company.id, gitIdentityInputSchema.parse(form)));
      setPreview(null);
      await onChanged();
    });

  if (!status) return error ? <p className="error">{error}</p> : <p className="hint">Reading your git settings.</p>;

  return (
    <div className="git-identity">
      {field('name', 'Name for commits')}
      {field('email', 'Email for commits')}
      {field('githubUser', 'GitHub user', 'Optional. Tells agents which account belongs to this client.')}
      {field('folder', 'Folder of this client', 'Every repository inside this folder commits with this identity, including each task’s own copy.')}
      <div className="inline-form">
        <button type="button" className="quiet" disabled={busy} onClick={showPreview}>
          <Eye size={15} />
          Preview changes
        </button>
      </div>
      {invalid && <p className="error">{invalid}</p>}
      {preview &&
        (preview.existingFile ? (
          <div className="git-identity-preview">
            <p className="hint">
              Your git config already has a rule for {preview.folder}, using {preview.existingFile}. Hatstand will not change it. It only checks that repositories commit with this email.
            </p>
            <button type="button" disabled={busy} onClick={() => void apply()}>
              Check and use this identity
            </button>
          </div>
        ) : (
          <div className="git-identity-preview">
            <p className="hint">This is everything Hatstand will write. Your other git settings stay as they are, and a copy of your config is saved first.</p>
            <pre aria-label="Changes to your git config">{preview.preview}</pre>
            <button type="button" disabled={busy} onClick={() => void apply()}>
              Apply to my git config
            </button>
          </div>
        ))}
      {company.gitIdentity?.appliedAt && status && status.repos.length > 0 && (
        <ul className="git-identity-repos" aria-label="Repositories and their identity">
          {status.repos.map((repo) => (
            <li key={repo.path}>
              {repo.matches ? <Check size={14} /> : <TriangleAlert size={14} />}
              <strong>{repo.name}</strong>
              <span className="hint">
                {repo.matches ? `commits as ${repo.email}` : repo.covered ? `commits as ${repo.email ?? 'nobody'}, so a setting inside this repository may be overriding the rule` : `is outside this folder and commits as ${repo.email ?? 'nobody'}. Agents still use this identity`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {company.projects.length === 0 && <p className="hint">This client has no repositories yet, so you can skip this step.</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
