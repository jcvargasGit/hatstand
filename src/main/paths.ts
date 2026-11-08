import { existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export function resolveHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.HATSTAND_HOME ?? join(homedir(), '.hatstand'));
}

export function findGitRoot(start: string): string | null {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function assertOutsideGit(home: string): void {
  const root = findGitRoot(home);
  if (root) {
    throw new Error(
      `Hatstand keeps client data in ${home}, which is inside the git repository ${root}. ` +
        'Set HATSTAND_HOME to a folder outside any repository.',
    );
  }
}

export function expandUserPath(raw: string, home: string): string {
  const cleaned = raw.trim().replace(/^(["'])(.*)\1$/, '$2').replace(/\\ /g, ' ');
  return cleaned === '~' || cleaned.startsWith('~/') ? join(home, cleaned.slice(1)) : cleaned;
}

export function prepareCloneDir(raw: string, dataHome: string, home = homedir()): string {
  const expanded = expandUserPath(raw, home);
  if (!isAbsolute(expanded)) throw new Error('Write the full path, starting with / or ~/. For example ~/projects/client.');
  const path = resolve(expanded);
  const fromData = relative(resolve(dataHome), path);
  if (!fromData.startsWith('..') && !isAbsolute(fromData)) {
    throw new Error('Choose a folder outside Hatstand\'s own data folder.');
  }
  const gitRoot = findGitRoot(path);
  if (gitRoot) throw new Error(`${path} is inside the git repository ${gitRoot}. Choose a folder outside any repository.`);
  mkdirSync(path, { recursive: true });
  return path;
}

export function resolveUserPath(raw: string, kind: 'directory' | 'file', home = homedir()): string {
  const expanded = expandUserPath(raw, home);
  if (!isAbsolute(expanded)) {
    throw new Error(`Write the full path, starting with / or ~/. For example ~/projects/client/${kind === 'file' ? 'notes.md' : 'docs'}.`);
  }
  const path = resolve(expanded);
  if (!existsSync(path)) throw new Error(`${path} does not exist. Check the spelling.`);
  const isDirectory = statSync(path).isDirectory();
  if (kind === 'directory' && !isDirectory) throw new Error(`${path} is a file. Choose a folder.`);
  if (kind === 'file' && isDirectory) throw new Error(`${path} is a folder. Choose a file.`);
  return path;
}

export type DataPaths = ReturnType<typeof dataPaths>;

export function dataPaths(home: string) {
  const company = (companyId: string) => join(home, 'companies', companyId);
  return {
    home,
    accountsFile: join(home, 'accounts.yaml'),
    preferencesFile: join(home, 'preferences.yaml'),
    companiesDir: join(home, 'companies'),
    removedDir: join(home, 'removed'),
    company,
    companyFile: (companyId: string) => join(company(companyId), 'company.yaml'),
    secretsFile: (companyId: string) => join(company(companyId), 'secrets.enc'),
    photoFile: (companyId: string) => join(company(companyId), 'photo'),
    instructionsFile: (companyId: string) => join(company(companyId), 'instructions.md'),
    knowledgeDir: (companyId: string) => join(company(companyId), 'knowledge'),
    planningDir: (companyId: string) => join(company(companyId), 'planning'),
    pluginDir: (companyId: string) => join(company(companyId), 'plugin'),
    skillsDir: (companyId: string) => join(company(companyId), 'plugin', 'skills'),
    pluginManifest: (companyId: string) => join(company(companyId), 'plugin', '.claude-plugin', 'plugin.json'),
    playbooksDir: (companyId: string) => join(company(companyId), 'playbooks'),
    areasDir: (companyId: string) => join(company(companyId), 'areas'),
    areaDir: (companyId: string, folder: string) => join(company(companyId), 'areas', folder),
    oldProjectsDir: (companyId: string) => join(company(companyId), 'projects'),
    backupsDir: join(home, 'backups'),
    tasksDir: (companyId: string) => join(company(companyId), 'tasks'),
    taskCounterFile: (companyId: string) => join(company(companyId), 'task-counter'),
    taskFile: (companyId: string, taskId: string) =>
      join(company(companyId), 'tasks', `${taskId}.json`),
    notesFile: (companyId: string, taskId: string) =>
      join(company(companyId), 'tasks', `${taskId}.md`),
    planFile: (companyId: string, taskId: string) =>
      join(company(companyId), 'tasks', 'plans', `${taskId}.json`),
    feedbackFile: (companyId: string, taskId: string) =>
      join(company(companyId), 'tasks', `${taskId}.feedback.md`),
    taskWorktreesDir: (companyId: string, taskId: string) => join(home, 'worktrees', companyId, taskId),
    sessionsDir: join(home, 'sessions'),
    sessionFile: (sessionId: string) => join(home, 'sessions', `${sessionId}.json`),
    runDir: join(home, 'run'),
    statusFile: (sessionId: string) => join(home, 'run', `${sessionId}.status`),
    sessionDir: (sessionId: string) => join(home, 'run', sessionId),
    promptFile: (sessionId: string) => join(home, 'run', `${sessionId}.prompt.md`),
    toolsDir: join(home, 'tools'),
    editRepoTool: join(home, 'tools', 'hatstand-edit-repo'),
    stepDoneTool: join(home, 'tools', 'hatstand-step-done'),
    stepFile: (sessionId: string) => join(home, 'run', `${sessionId}.step`),
    checkPlanTool: join(home, 'tools', 'hatstand-check-plan'),
    planChecksDir: (sessionId: string) => join(home, 'run', `${sessionId}.plan-checks`),
    copyRequestsDir: (sessionId: string) => join(home, 'run', `${sessionId}.requests`),
    settingsFile: (sessionId: string) => join(home, 'run', `${sessionId}.settings.json`),
    activityFile: (sessionId: string) => join(home, 'run', `${sessionId}.activity.jsonl`),
    guardDir: join(home, 'guard'),
    guardScript: join(home, 'guard', 'guard.cjs'),
    guardFingerprints: (companyId: string) => join(home, 'guard', `${companyId}.json`),
  };
}
