import { FileUp, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useAction } from '../hooks/useAction';

type AddKeyFormProps = {
  onAdd: (name: string, value: string) => Promise<void>;
  /** Says how many keys came from the env file the person chose. */
  onImport: () => Promise<number>;
};

export function AddKeyForm({ onAdd, onImport }: AddKeyFormProps) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const { error, busy, run } = useAction();

  const add = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await onAdd(name, value);
      setName('');
      setValue('');
    });
  };

  const importFile = () =>
    run(async () => {
      const count = await onImport();
      setMessage(count > 0 ? `Imported ${count} keys.` : null);
    });

  return (
    <div className="field-block">
      <form className="inline-form" onSubmit={add}>
        <input aria-label="Key name" placeholder="NAME" value={name} onChange={(event) => setName(event.target.value)} />
        <input
          aria-label="Key value"
          type="password"
          placeholder="Value"
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <button className="quiet" type="submit" disabled={!name || !value || busy}>
          <Plus size={15} />
          Add key
        </button>
        <button className="quiet" type="button" disabled={busy} onClick={() => void importFile()}>
          <FileUp size={15} />
          Import from an env file
        </button>
      </form>
      {message && <p className="hint">{message}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
