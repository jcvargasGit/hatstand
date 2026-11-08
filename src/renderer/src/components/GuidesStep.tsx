import { Plus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { Company } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { usePlaybooks } from '../hooks/usePlaybooks';
import { api } from '../lib/api';
import { plural } from '../lib/text';
import { ClientFiles } from './ClientFiles';

type GuidesStepProps = {
  company: Company;
  onSave: (company: Company) => unknown;
  onOpenTask: (taskId: string) => Promise<void>;
};

const ORIGIN_TEXT = { 'built-in': 'Built in', customized: 'Customized for this client', client: 'This client only' };

export function GuidesStep({ company, onSave, onOpenTask }: GuidesStepProps) {
  const companyId = company.id;
  const { playbooks, problems, reload } = usePlaybooks(companyId);
  const defaultPlaybookId = playbooks.find((playbook) => playbook.id === company.defaultPlaybookId)?.id ?? '';
  const [name, setName] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const { error, busy, run } = useAction();

  const change = (action: () => Promise<void>) =>
    run(async () => {
      await action();
      setRemoving(null);
      await reload();
    });

  useEffect(() => {
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  const create = (event: FormEvent) => {
    event.preventDefault();
    void change(async () => {
      setOpenPath(await api.createPlaybook(companyId, name));
      setName('');
    });
  };

  return (
    <div className="guides-step">
      <label className="stacked-field">
        Default guide for new tasks
        <select value={defaultPlaybookId} onChange={(event) => void onSave({ ...company, defaultPlaybookId: event.target.value || undefined })}>
          <option value="">No guide</option>
          {playbooks.map((playbook) => (
            <option key={playbook.id} value={playbook.id}>
              {playbook.name}
            </option>
          ))}
        </select>
        <small className="hint">New tasks of {company.name} start with this guide. You can still change it on each task.</small>
      </label>
      <ul className="guide-list">
        {playbooks.map((playbook) => (
          <li key={playbook.id}>
            <div className="guide-list-text">
              <strong>{playbook.name}</strong>
              {playbook.description && <span>{playbook.description}</span>}
              <small>
                {plural(playbook.steps.length, 'step', 'steps')}, {ORIGIN_TEXT[playbook.origin]}
              </small>
            </div>
            {playbook.origin === 'built-in' && (
              <button className="quiet" disabled={busy} aria-label={`Customize ${playbook.name}`} onClick={() => void change(async () => setOpenPath(await api.customizePlaybook(companyId, playbook.id)))}>
                Customize
              </button>
            )}
            {playbook.file && (
              <button className="quiet" disabled={busy} aria-label={`Edit ${playbook.name}`} onClick={() => setOpenPath(playbook.file ?? null)}>
                Edit
              </button>
            )}
            {playbook.origin !== 'built-in' &&
              (removing === playbook.id ? (
                <button className="danger" disabled={busy} onClick={() => void change(() => api.removePlaybook(companyId, playbook.id))}>
                  {playbook.origin === 'customized' ? 'Confirm: use the built-in guide' : 'Confirm: delete this guide'}
                </button>
              ) : (
                <button className="quiet" disabled={busy} aria-label={`${playbook.origin === 'customized' ? 'Reset' : 'Delete'} ${playbook.name}`} onClick={() => setRemoving(playbook.id)}>
                  {playbook.origin === 'customized' ? 'Reset' : 'Delete'}
                </button>
              ))}
          </li>
        ))}
      </ul>
      {problems.map((problem) => (
        <p key={problem} className="warning">
          {problem}
        </p>
      ))}
      <form className="inline-form" onSubmit={create}>
        <input aria-label="New guide name" placeholder="New guide name" value={name} onChange={(event) => setName(event.target.value)} />
        <button className="quiet" disabled={busy || !name.trim()}>
          <Plus size={15} />
          New guide
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      <ClientFiles
        companyId={companyId}
        scope="guides"
        refreshKey={playbooks.map((playbook) => `${playbook.id}:${playbook.origin}`).join('|')}
        onOpenTask={onOpenTask}
        openPath={openPath}
        onOpened={() => setOpenPath(null)}
      />
    </div>
  );
}
