import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { Company } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { CLIENT_COLORS } from '../lib/today';
import { ClientAvatar } from './ClientAvatar';
import { ColorField } from './ColorField';

type NewClientFormProps = {
  isFirst: boolean;
  usedColors: string[];
  onCreated: (companyId: string) => Promise<void>;
};

export function NewClientForm({ isFirst, usedColors, onCreated }: NewClientFormProps) {
  const [name, setName] = useState('');
  const [origin, setOrigin] = useState<Company['origin']>('scratch');
  const [color, setColor] = useState(
    CLIENT_COLORS.find((item) => !usedColors.includes(item)) ?? CLIENT_COLORS[0] ?? '#E8A33D',
  );
  const { error, busy, run } = useAction();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const company = await api.createCompany(name, color, origin);
      await onCreated(company.id);
    });
  };

  return (
    <main className="page page-narrow">
      <form className="new-client" onSubmit={submit}>
        <ClientAvatar company={{ id: 'new', name: name || '?', color }} size="large" />
        <h1>{isFirst ? 'Add your first client' : 'Add a client'}</h1>
        <label>
          Client or project name
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <fieldset className="source-choice">
          <legend>How do you want to start?</legend>
          <label>
            <input type="radio" name="origin" checked={origin === 'scratch'} onChange={() => setOrigin('scratch')} />
            <span>
              Start from scratch
              <small>Hatstand creates the folders and starter files, then helps you sign in and download the repositories.</small>
            </span>
          </label>
          <label>
            <input type="radio" name="origin" checked={origin === 'existing'} onChange={() => setOrigin('existing')} />
            <span>
              I already have folders
              <small>Use your repositories, skills and knowledge where they are.</small>
            </span>
          </label>
        </fieldset>
        <ColorField value={color} onChange={setColor} />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy || !name.trim()}>
          <Plus size={16} />
          Add client
        </button>
      </form>
    </main>
  );
}
