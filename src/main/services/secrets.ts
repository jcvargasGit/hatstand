import { readFileSync } from 'node:fs';
import type { HatstandApi } from '../../shared/api';
import { secretNameSchema } from '../../shared/schemas';
import { parseEnvFile } from '../env';
import type { ServiceContext } from './context';

export type SecretService = Pick<HatstandApi, 'listSecretNames' | 'setSecret' | 'deleteSecret'>;

/** Saves the values of an env file the person chose as secrets of the client, and says how many. No file means the person changed their mind. */
export function importEnvFile({ secrets, emit }: Pick<ServiceContext, 'secrets' | 'emit'>, companyId: string, file: string | null): number {
  if (!file) return 0;
  const values = parseEnvFile(readFileSync(file, 'utf8'));
  secrets.merge(companyId, values);
  emit('state-changed', null);
  return Object.keys(values).length;
}

export function createSecretService({ secrets, emit }: Pick<ServiceContext, 'secrets' | 'emit'>): SecretService {
  return {
    listSecretNames: async (companyId) => secrets.names(companyId),
    setSecret: async (companyId, name, value) => {
      secrets.merge(companyId, { [secretNameSchema.parse(name)]: value });
      emit('state-changed', null);
    },
    deleteSecret: async (companyId, name) => {
      secrets.remove(companyId, name);
      emit('state-changed', null);
    },
  };
}
