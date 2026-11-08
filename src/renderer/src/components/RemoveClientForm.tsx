import { useState, type FormEvent } from 'react';
import type { ClientRemovalReport } from '../../../shared/api';
import type { Company } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { plural } from '../lib/text';

type RemoveClientFormProps = {
  company: Company;
  onRemoved: (report: ClientRemovalReport) => Promise<void>;
  onCancel: () => void;
};

export function RemoveClientForm({ company, onRemoved, onCancel }: RemoveClientFormProps) {
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [typed, setTyped] = useState('');
  const { error, busy, run } = useAction();
  const confirmed = typed.trim() === company.name;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed) return;
    void run(async () => {
      await onRemoved(await api.removeClient(company.id, deleteFiles));
    });
  };

  return (
    <form className="remove-client" aria-label={`Remove ${company.name}`} onSubmit={submit}>
      <fieldset className="source-choice">
        <legend className="visually-hidden">What to do with this client&rsquo;s files</legend>
        <label>
          <input type="radio" name="remove-files" checked={!deleteFiles} onChange={() => setDeleteFiles(false)} />
          <span>
            Remove from Hatstand and keep the files
            <small>Knowledge, skills, guides, instructions and task notes move to a folder called removed, in your Hatstand data.</small>
          </span>
        </label>
        <label>
          <input type="radio" name="remove-files" checked={deleteFiles} onChange={() => setDeleteFiles(true)} />
          <span>
            Remove from Hatstand and delete the files
            <small>Permanently deletes this client&rsquo;s Hatstand folder, including knowledge, skills, guides, instructions and task notes.</small>
          </span>
        </label>
      </fieldset>
      <ul className="remove-client-facts">
        <li>Saved keys for this client are always deleted.</li>
        <li>
          {company.projects.length > 0
            ? `${plural(company.projects.length, 'repository stays', 'repositories stay')} where ${company.projects.length === 1 ? 'it is' : 'they are'}, with your code untouched. Hatstand only removes its commit check.`
            : 'This client has no repositories in Hatstand.'}
        </li>
        <li>Folders you added from elsewhere stay where they are, and so do the agents&rsquo; own conversations.</li>
      </ul>
      <label className="stacked-field">
        Type {company.name} to confirm
        <input value={typed} onChange={(event) => setTyped(event.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="inline-form">
        <button className={deleteFiles ? 'danger' : undefined} disabled={busy || !confirmed}>
          {deleteFiles ? 'Delete client and files' : 'Remove client'}
        </button>
        <button type="button" className="quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
