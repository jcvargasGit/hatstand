import { useState } from 'react';
import type { Company } from '../../../shared/schemas';
import { useClientPhoto } from '../hooks/useClientPhoto';
import { initials, inkOn } from '../lib/today';

type ClientAvatarProps = {
  company: Pick<Company, 'id' | 'name' | 'color' | 'photo'>;
  size?: 'small' | 'medium' | 'large';
};

export function ClientAvatar({ company, size = 'medium' }: ClientAvatarProps) {
  const photo = useClientPhoto(company.id, company.photo?.savedAt);
  const [failed, setFailed] = useState(false);

  if (photo && !failed) {
    return <img className={`avatar avatar-${size}`} src={photo} alt="" onError={() => setFailed(true)} />;
  }
  return (
    <span className={`avatar avatar-${size}`} style={{ background: company.color, color: inkOn(company.color) }} aria-hidden="true">
      {initials(company.name)}
    </span>
  );
}
