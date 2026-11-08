import { ImagePlus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { Company } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { ClientAvatar } from './ClientAvatar';

type PhotoFieldProps = {
  company: Company;
  onChanged: () => Promise<void>;
};

export function PhotoField({ company, onChanged }: PhotoFieldProps) {
  const [link, setLink] = useState('');
  const { error, busy, run } = useAction();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await api.setClientPhoto(company.id, link);
      setLink('');
      await onChanged();
    });
  };

  const remove = () =>
    void run(async () => {
      await api.removeClientPhoto(company.id);
      await onChanged();
    });

  return (
    <div className="field-block">
      <h3>Photo</h3>
      <p className="hint">Paste a link to an image, for example from Google Images. Hatstand saves a copy on this computer.</p>
      <div className="photo-field">
        <ClientAvatar company={company} size="large" />
        <form className="inline-form photo-form" onSubmit={submit}>
          <input
            aria-label="Photo link"
            placeholder="https://"
            value={link}
            onChange={(event) => setLink(event.target.value)}
          />
          <button className="quiet" type="submit" disabled={busy || !link.trim()}>
            <ImagePlus size={15} />
            {busy ? 'Saving photo' : 'Save photo'}
          </button>
          {company.photo && (
            <button className="quiet" type="button" disabled={busy} onClick={remove}>
              <Trash2 size={15} />
              Remove photo
            </button>
          )}
        </form>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
