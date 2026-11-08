import { useState } from 'react';
import type { Company } from '../../../shared/schemas';
import { ColorField } from './ColorField';
import { PhotoField } from './PhotoField';

type IdentityStepProps = {
  company: Company;
  onSave: (company: Company) => Promise<void>;
  onChanged: () => Promise<void>;
};

export function IdentityStep({ company, onSave, onChanged }: IdentityStepProps) {
  const [name, setName] = useState(company.name);
  const usesCode = company.projects.length > 0;

  const saveName = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== company.name) void onSave({ ...company, name: trimmed });
  };

  return (
    <>
      <label className="stacked-field">
        Client or project name
        <input value={name} onChange={(event) => setName(event.target.value)} onBlur={saveName} />
      </label>
      <ColorField value={company.color} onChange={(color) => void onSave({ ...company, color })} />
      <PhotoField company={company} onChanged={onChanged} />
      <label className="check">
        <input type="checkbox" checked={company.hasCode} disabled={usesCode} onChange={(event) => void onSave({ ...company, hasCode: event.target.checked })} />
        <span>
          This client has code
          <small>{usesCode ? 'To turn this off, first remove its repositories.' : 'Turn this off for work without repositories. It hides Repositories, Commit identity and Protection.'}</small>
        </span>
      </label>
    </>
  );
}
