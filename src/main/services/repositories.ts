import type { HatstandApi } from '../../shared/api';
import { gitOrigin, gitTokenName } from '../../shared/git-source';
import { gitSourceSchema, type GitSource } from '../../shared/schemas';
import { listRemoteRepos } from '../git-hosts';
import { noteAcceptedKey, noteRejectedKey } from '../key-rejected';
import { findGitRoot, prepareCloneDir, resolveUserPath } from '../paths';
import { cloneRepos } from '../repo-clone';
import { detectRepoLayout } from '../repo-layout';
import { scanRepos } from '../shell';
import type { ServiceContext } from './context';

export type RepositoryService = Pick<HatstandApi, 'connectGitSource' | 'downloadRepos' | 'inspectRepoLayout' | 'scanRepos' | 'isInsideGitRepo' | 'resolvePath'>;

export function createRepositoryService({ store, paths, secrets, tools, emit, userHome, fetch }: ServiceContext): RepositoryService {
  /** Clients downloading right now, so a second click does not clone the same repositories twice. */
  const downloading = new Set<string>();
  /** Lists with the saved token of the client, and remembers whether the provider accepted it. */
  const listWithSavedToken = async (companyId: string, source: GitSource, token: string) => {
    try {
      const repos = await listRemoteRepos(source, token, fetch);
      noteAcceptedKey(secrets, companyId, source.provider);
      return repos;
    } catch (error) {
      if (noteRejectedKey(secrets, companyId, error)) emit('state-changed', null);
      throw error;
    }
  };
  return {
    connectGitSource: async (companyId, rawSource, rawToken) => {
      const source = gitSourceSchema.parse(rawSource);
      const tokenName = gitTokenName(source.provider);
      const pasted = rawToken?.trim();
      const token = pasted || secrets.read(companyId)[tokenName];
      if (!token) throw new Error('Paste a token so Hatstand can see this client\'s repositories.');
      // A token that was only pasted is not the saved key, so its rejection says nothing about that key.
      const repos = pasted ? await listRemoteRepos(source, token, fetch) : await listWithSavedToken(companyId, source, token);
      secrets.merge(companyId, {
        [tokenName]: token,
        ...(source.provider === 'gitlab' ? { GITLAB_URL: gitOrigin(source) } : {}),
      });
      noteAcceptedKey(secrets, companyId, source.provider);
      store.saveCompany({ ...store.readCompany(companyId), gitSource: source });
      emit('state-changed', null);
      return repos;
    },
    downloadRepos: async (companyId, rawDir, repoPaths) => {
      if (downloading.has(companyId)) throw new Error('This client is already downloading repositories.');
      const source = store.readCompany(companyId).gitSource;
      if (!source) throw new Error('Connect GitHub or GitLab first.');
      const token = secrets.read(companyId)[gitTokenName(source.provider)];
      if (!token) throw new Error('Paste a token so Hatstand can download this client\'s repositories.');
      const baseDir = prepareCloneDir(rawDir, paths.home, userHome);
      downloading.add(companyId);
      try {
        const available = await listWithSavedToken(companyId, source, token);
        return await cloneRepos({
          repos: available.filter((repo) => repoPaths.includes(repo.path)),
          baseDir,
          provider: source.provider,
          token,
          path: tools.path,
          onProgress: (progress, target) => {
            if (progress.state === 'cloned' || progress.state === 'existing') {
              store.addClonedProject(companyId, baseDir, progress.path, target);
              emit('state-changed', null);
            }
            emit('clone-progress', { ...progress, companyId });
          },
        });
      } finally {
        downloading.delete(companyId);
      }
    },
    inspectRepoLayout: async (companyId, projectId) => {
      const project = store.readCompany(companyId).projects.find((item) => item.id === projectId);
      if (!project) throw new Error('This repository is no longer part of this client.');
      return detectRepoLayout(project.path);
    },
    scanRepos: async (dir) => scanRepos(dir),
    isInsideGitRepo: async (path) => findGitRoot(path) !== null,
    resolvePath: async (path, kind) => resolveUserPath(path, kind, userHome),
  };
}
