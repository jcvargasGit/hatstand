import { useEffect, useState } from 'react';
import type { Snapshot } from '../../../shared/api';
import { clientReadiness, type ClientReadiness } from '../../../shared/readiness';
import type { Company } from '../../../shared/schemas';
import { api } from '../lib/api';

export function useClientReadiness(snapshot: Snapshot, company: Company): ClientReadiness & { loaded: boolean } {
  const [secretNames, setSecretNames] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const companyId = company.id;

  useEffect(() => {
    let active = true;
    const load = () =>
      void api
        .listSecretNames(companyId)
        .catch(() => [])
        .then((names) => {
          if (!active) return;
          setSecretNames(names);
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
    secretNames,
    hasLocalKnowledge: snapshot.localKnowledge.includes(companyId),
    hasLocalPlugin: snapshot.localPlugin.includes(companyId),
    hasStarterInstructions: snapshot.starterInstructions.includes(companyId),
  });
  return { ...readiness, loaded };
}
