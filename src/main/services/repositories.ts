import type { CloneProgress, HatstandApi } from '../../shared/api';
import { GITHUB_HOST, gitOrigin, gitTokenName, parseRepoLink } from '../../shared/git-source';
import { gitSourceSchema, type GitSource } from '../../shared/schemas';
import { listRemoteRepos } from '../git-hosts';
import { noteAcceptedKey, noteRejectedKey } from '../key-rejected';
import { findGitRoot, prepareCloneDir, resolveUserPath } from '../paths';
import { cloneRepos } from '../repo-clone';
import { detectRepoLayout } from '../repo-layout';
import { scanRepos } from '../shell';
import type { ServiceContext } from './context';

export type RepositoryService = Pick<HatstandApi, 'connectGitSource' | 'downloadRepos' | 'downloadRepoByLink' | 'inspectRepoLayout' | 'scanRepos' | 'isInsideGitRepo' | 'resolvePath'>;

export function createRepositoryService({ store, paths, secrets, tools, emit, userHome, fetch }: ServiceContext): RepositoryService {
  /** Clients downloading right now, so a second click does not clone the same repositories twice. */
  const downloading = new Set<string>();
  const reportTo = (companyId: string, baseDir: string) => (progress: CloneProgress, target: string) => {
    if (progress.state === 'cloned' || progress.state === 'existing') {
      store.addClonedProject(companyId, baseDir, progress.path, target);
      emit('state-changed', null);
    }
    emit('clone-progress', { ...progress, companyId });
  };
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
          onProgress: reportTo(companyId, baseDir),
        });
      } finally {
        downloading.delete(companyId);
      }
    },
    downloadRepoByLink: async (companyId, link, rawDir) => {
      if (downloading.has(companyId)) throw new Error('This client is already downloading repositories.');
      const host = store.readCompany(companyId).gitSource ?? GITHUB_HOST;
      const { cloneUrl, name } = parseRepoLink(link, host);
      const tokenName = gitTokenName(host.provider);
      const token = secrets.read(companyId)[tokenName];
      const baseDir = prepareCloneDir(rawDir, paths.home, userHome);
      downloading.add(companyId);
      try {
        const [result] = await cloneRepos({
          repos: [{ path: name, description: '', cloneUrl, archived: false }],
          baseDir,
          provider: host.provider,
          token,
          path: tools.path,
          onProgress: reportTo(companyId, baseDir),
        });
        if (!result) throw new Error('Git could not download this repository.');
        if (result.state !== 'failed' || token) return result;
        return { ...result, error: `${result.error} If the repository is private, add ${tokenName} to this client's keys.` };
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
