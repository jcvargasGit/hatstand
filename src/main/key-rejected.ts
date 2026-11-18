import { serviceTokenName, type KeyServiceId } from '../shared/known-keys';
import type { SecretStore } from './secrets';

/** A provider answered that the token is not valid. Carries which provider, so Hatstand can mark the key. */
export class KeyRejectedError extends Error {
  constructor(
    message: string,
    readonly service: KeyServiceId,
  ) {
    super(message);
    this.name = 'KeyRejectedError';
  }
}

export type KeyNotes = Pick<SecretStore, 'names' | 'recordCheck' | 'clearRejection'>;

/** Marks the key of a client as rejected when that is why a call failed. Says whether the mark is new. */
export function noteRejectedKey(keys: KeyNotes, companyId: string, error: unknown): boolean {
  if (!(error instanceof KeyRejectedError)) return false;
  return keys.recordCheck(companyId, serviceTokenName(error.service, keys.names(companyId)), { result: 'rejected' });
}

/** Removes the mark once the provider accepts the key again. Says whether there was a mark. */
export function noteAcceptedKey(keys: KeyNotes, companyId: string, service: KeyServiceId): boolean {
  return keys.clearRejection(companyId, serviceTokenName(service, keys.names(companyId)));
}
