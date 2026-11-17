import type { HatstandApi } from '../../shared/api';
import { gitIdentityInputSchema } from '../../shared/schemas';
import { DEV_COPY_MESSAGE, isDevCopy } from '../dev-copy';
import { applyGitIdentity, gitIdentityStatus, previewGitIdentity } from '../git-identity';
import type { ServiceContext } from './context';

export type GitIdentityService = Pick<HatstandApi, 'gitIdentityStatus' | 'previewGitIdentity' | 'applyGitIdentity'>;

export function createGitIdentityService({ store, paths, tools, emit, userHome }: ServiceContext): GitIdentityService {
  return {
    gitIdentityStatus: async (companyId) => gitIdentityStatus(store.readCompany(companyId), tools.path, userHome),
    previewGitIdentity: async (companyId, identity) => previewGitIdentity(store.readCompany(companyId), gitIdentityInputSchema.parse(identity), tools.path, userHome),
    applyGitIdentity: async (companyId, identity) => {
      if (isDevCopy()) throw new Error(DEV_COPY_MESSAGE);
      const input = gitIdentityInputSchema.parse(identity);
      const company = await applyGitIdentity(store.readCompany(companyId), input, tools.path, paths.backupsDir, userHome);
      store.saveCompany(company);
      emit('state-changed', null);
      return gitIdentityStatus(company, tools.path, userHome);
    },
  };
}
