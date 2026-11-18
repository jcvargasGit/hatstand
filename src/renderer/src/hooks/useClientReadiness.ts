import { useEffect, useState } from 'react';
import type { Snapshot } from '../../../shared/api';
import { clientReadiness, type ClientReadiness } from '../../../shared/readiness';
import type { Company, KeyInfo } from '../../../shared/schemas';
import { api } from '../lib/api';

export function useClientReadiness(snapshot: Snapshot, company: Company): ClientReadiness & { loaded: boolean } {
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const companyId = company.id;

  useEffect(() => {
    let active = true;
    const load = () =>
      void api
        .listKeys(companyId)
        .catch(() => [])
        .then((found) => {
          if (!active) return;
          setKeys(found);
          setLoaded(true);
        });
    load();
    const stop = window.hatstand.on('state-changed', load);
    return () => {
      active = false;
      stop();
    };
  }, [companyId]);

  const readiness = clientReadiness({
    company,
    secretNames: keys.map((key) => key.name),
    keys,
    hasLocalKnowledge: snapshot.localKnowledge.includes(companyId),
    hasLocalPlugin: snapshot.localPlugin.includes(companyId),
    hasStarterInstructions: snapshot.starterInstructions.includes(companyId),
  });
  return { ...readiness, loaded };
}
