import type { HatstandApi } from '../../shared/api';
import { gitOrigin, gitTokenName } from '../../shared/git-source';
import { gitSourceSchema } from '../../shared/schemas';
import { listRemoteRepos } from '../git-hosts';
import { findGitRoot, prepareCloneDir, resolveUserPath } from '../paths';
import { cloneRepos } from '../repo-clone';
import { detectRepoLayout } from '../repo-layout';
import { scanRepos } from '../shell';
import type { ServiceContext } from './context';

export type RepositoryService = Pick<HatstandApi, 'connectGitSource' | 'downloadRepos' | 'inspectRepoLayout' | 'scanRepos' | 'isInsideGitRepo' | 'resolvePath'>;

export function createRepositoryService({ store, paths, secrets, tools, emit, userHome, fetch }: ServiceContext): RepositoryService {
  /** Clients downloading right now, so a second click does not clone the same repositories twice. */
  const downloading = new Set<string>();
  return {
    connectGitSource: async (companyId, rawSource, rawToken) => {
      const source = gitSourceSchema.parse(rawSource);
      const tokenName = gitTokenName(source.provider);
      const token = rawToken?.trim() || secrets.read(companyId)[tokenName];
      if (!token) throw new Error('Paste a token so Hatstand can see this client\'s repositories.');
      const repos = await listRemoteRepos(source, token, fetch);
      secrets.merge(companyId, {
        [tokenName]: token,
        ...(source.provider === 'gitlab' ? { GITLAB_URL: gitOrigin(source) } : {}),
      });
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
        const available = await listRemoteRepos(source, token, fetch);
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
