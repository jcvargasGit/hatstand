import { existsSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import type { CloneProgress, HatstandApi, RemoteRepo } from '../../shared/api';
import { GITHUB_HOST, gitOrigin, gitTokenName, parseRepoLink } from '../../shared/git-source';
import { gitSourceSchema, type GitSource } from '../../shared/schemas';
import { listRemoteRepos } from '../git-hosts';
import { noteAcceptedKey, noteRejectedKey } from '../key-rejected';
import { findGitRoot, prepareCloneDir, resolveUserPath } from '../paths';
import { cloneRepos, cloneTarget, describeBlockedFolder, folderState } from '../repo-clone';
import { detectRepoLayout } from '../repo-layout';
import { scanRepos } from '../shell';
import type { ServiceContext } from './context';

export type RepositoryService = Pick<
  HatstandApi,
  'connectGitSource' | 'downloadRepos' | 'downloadRepoByLink' | 'inspectBlockedFolder' | 'trashBlockedFolder' | 'inspectRepoLayout' | 'scanRepos' | 'isInsideGitRepo' | 'resolvePath'
>;

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Whether a folder is another one, or is somewhere inside it. */
function isInsideFolder(path: string, folder: string): boolean {
  const fromFolder = relative(folder, path);
  return !fromFolder.startsWith('..') && !isAbsolute(fromFolder);
}

export function createRepositoryService({ store, paths, secrets, tools, emit, userHome, fetch, trash }: ServiceContext): RepositoryService {
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
  /** Folders a download found taken, with the repository that was meant to go there. Only these can go to the trash. */
  const blocked = new Map<string, string>();
  const blockedKey = (companyId: string, target: string) => `${companyId}\n${target}`;
  const rememberBlocked = (companyId: string, baseDir: string, repos: RemoteRepo[], results: CloneProgress[]) => {
    for (const result of results) {
      const key = blockedKey(companyId, cloneTarget(baseDir, result.path));
      const repo = repos.find((item) => item.path === result.path);
      if (result.blocker && repo) blocked.set(key, repo.cloneUrl);
      else blocked.delete(key);
    }
    return results;
  };
  const findBlocked = async (companyId: string, rawDir: string, repoPath: string) => {
    const target = cloneTarget(prepareCloneDir(rawDir, paths.home, userHome), repoPath);
    const cloneUrl = blocked.get(blockedKey(companyId, target));
    if (!cloneUrl) throw new Error('Download this repository again, so Hatstand checks its folder first.');
    const state = await folderState(target, cloneUrl, tools.path);
    if (state.kind !== 'blocked') {
      blocked.delete(blockedKey(companyId, target));
      throw new Error(`${target} no longer stops the download. Download the repository again.`);
    }
    return { target, state };
  };
  /** The client that works in a folder, or in one inside it, so that folder is never moved to the trash. */
  const clientUsing = (target: string) =>
    store.listCompanies().find((company) =>
      [...company.projects.map((project) => project.path), company.planning?.path, company.rootDir]
        .filter((path): path is string => Boolean(path))
        .some((path) => isInsideFolder(path, target)),
    );
  return {
    inspectBlockedFolder: async (companyId, rawDir, repoPath) => {
      const { target, state } = await findBlocked(companyId, rawDir, repoPath);
      return describeBlockedFolder(target, state, tools.path);
    },
    trashBlockedFolder: async (companyId, rawDir, repoPath, typedName) => {
      if (downloading.has(companyId)) throw new Error('This client is already downloading repositories.');
      const name = repoPath.split('/').at(-1) ?? repoPath;
      if (typedName.trim() !== name) throw new Error(`Type ${name} to confirm.`);
      const { target } = await findBlocked(companyId, rawDir, repoPath);
      const user = clientUsing(target);
      if (user) throw new Error(`${user.name} uses ${target}, or a folder inside it. Remove it from that client first.`);
      if (isInsideFolder(paths.home, target)) throw new Error(`${target} holds Hatstand's own data folder, so Hatstand leaves it alone.`);
      try {
        await trash(target);
      } catch (error) {
        throw new Error(`Hatstand could not move ${target} to the trash, and nothing was deleted. ${errorText(error)}`);
      }
      if (existsSync(target)) throw new Error(`Hatstand could not move ${target} to the trash, and nothing was deleted.`);
      blocked.delete(blockedKey(companyId, target));
    },
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
        const repos = available.filter((repo) => repoPaths.includes(repo.path));
        const results = await cloneRepos({ repos, baseDir, provider: source.provider, token, path: tools.path, onProgress: reportTo(companyId, baseDir) });
        return rememberBlocked(companyId, baseDir, repos, results);
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
        const repos: RemoteRepo[] = [{ path: name, description: '', cloneUrl, archived: false }];
        const results = await cloneRepos({ repos, baseDir, provider: host.provider, token, path: tools.path, onProgress: reportTo(companyId, baseDir) });
        const [result] = rememberBlocked(companyId, baseDir, repos, results);
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
