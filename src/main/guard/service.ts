import { existsSync, readFileSync } from 'node:fs';
import type { GuardReport, RepoGuardStatus } from '../../shared/api';
import type { Company } from '../../shared/schemas';
import type { DataPaths } from '../paths';
import { AREA_STARTER_FILES, writePrivateFile } from '../store';
import { fingerprintDirs, fingerprintSecrets, fingerprintText, type Fingerprints } from './fingerprints';
import { buildGuardScript } from './hook-script';
import { inspectHook, installPreCommitHook, uninstallPreCommitHook } from './install';
import { workRepositories } from '../../shared/work-repos';
import { isInside } from '../planning';
import { isStarterInstructions } from '../starter-files';

const STARTER_LINES = new Set(Object.values(AREA_STARTER_FILES).flatMap((text) => fingerprintText(text)));

export function buildFingerprints(paths: DataPaths, company: Company, secrets: Record<string, string>): Fingerprints {
  const { instructionsFile, knowledgeDir, pluginDir } = company.context;
  const planningPath = company.planning?.path;
  const custom = [knowledgeDir, pluginDir].filter((dir) => dir !== undefined);
  const dirs = [paths.knowledgeDir(company.id), paths.pluginDir(company.id), paths.planningDir(company.id), paths.areasDir(company.id), ...custom].filter(
    (dir) => existsSync(dir) && !(planningPath && isInside(dir, planningPath)),
  );
  const rawInstructions = instructionsFile && existsSync(instructionsFile) ? readFileSync(instructionsFile, 'utf8') : '';
  const instructions = isStarterInstructions(rawInstructions) ? '' : rawInstructions;
  return {
    company: company.name,
    lineHashes: [...new Set([...fingerprintDirs(dirs), ...fingerprintText(instructions)])].filter((hash) => !STARTER_LINES.has(hash)),
    secrets: fingerprintSecrets(secrets),
  };
}

export function refreshFingerprints(paths: DataPaths, company: Company, secrets: Record<string, string>): void {
  const file = paths.guardFingerprints(company.id);
  if (existsSync(file)) writePrivateFile(file, JSON.stringify(buildFingerprints(paths, company, secrets)));
}

export function guardRepos(company: Company): { name: string; path: string }[] {
  return workRepositories(company).map(({ name, path }) => ({ name, path }));
}

export function clientRepoFolders(company: Company): string[] {
  return [...company.projects.map((repo) => repo.path), ...(company.planning ? [company.planning.path] : [])];
}

export function removeControlRepoHooks(company: Company, otherCompanies: Company[]): string[] {
  const usedElsewhere = new Set(otherCompanies.flatMap((other) => guardRepos(other).map((repo) => repo.path)));
  const work = new Set(guardRepos(company).map((repo) => repo.path));
  return clientRepoFolders(company).filter((path) => !work.has(path) && !usedElsewhere.has(path) && uninstallPreCommitHook(path));
}

export function guardStatus(company: Company): RepoGuardStatus[] {
  return guardRepos(company).map((repo) => ({ name: repo.name, ...inspectHook(repo.path) }));
}

export function installGuard(
  paths: DataPaths,
  company: Company,
  secrets: Record<string, string>,
  nodePath: string,
  keepExistingHooks: string[] = [],
): GuardReport {
  const fingerprints = buildFingerprints(paths, company, secrets);
  writePrivateFile(paths.guardFingerprints(company.id), JSON.stringify(fingerprints));
  writePrivateFile(paths.guardScript, buildGuardScript());

  const results = guardRepos(company).map((repo) =>
    installPreCommitHook(repo.path, nodePath, paths.guardScript, keepExistingHooks.includes(repo.path)),
  );
  return {
    installed: results.filter((result) => result.installed).map((result) => result.path),
    skipped: results.flatMap((result) =>
      result.installed ? [] : [{ path: result.path, reason: result.reason ?? 'Not installed.' }],
    ),
    knowledgeLines: fingerprints.lineHashes.length,
    secrets: fingerprints.secrets.length,
  };
}
