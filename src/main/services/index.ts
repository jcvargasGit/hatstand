// The services behind the API the interface calls, one file per domain. Each service receives what it
// needs as arguments, so none of them imports Electron, and a test builds any of them from a throwaway
// Store and fakes. src/main/index.ts composes them with the handlers that need Electron.
import type { HatstandApi } from '../../shared/api';
import type { AgentSignIn, checkAgent } from '../agent-status';
import type { DescriptionSuggester } from '../description-suggestion';
import type { ReviewMonitor } from '../review-monitor';
import type { SessionManager } from '../sessions';
import { createAccountService } from './accounts';
import { createBacklogService } from './backlog';
import { createChangeService } from './changes';
import { createClientFileService } from './client-files';
import { createClientService } from './clients';
import { createCodeCopies } from './code-copies';
import type { ServiceContext } from './context';
import { createGitIdentityService } from './git-identity';
import { createGuardService, type RepoProtection } from './guard';
import { createGuideService } from './guides';
import { createNewTaskDraftService, type NewTaskWindows } from './new-task-drafts';
import { createPlanningService } from './planning';
import { createPreferenceService, type PreferenceServiceDeps } from './preferences';
import { createReleaseService, type InstalledApp } from './release';
import { createRepositoryService } from './repositories';
import { createReviewService } from './reviews';
import { createSecretService } from './secrets';
import { createSessionService } from './sessions';
import { createTaskService } from './tasks';
import { createWorkspaceService } from './workspace';

export type { Emit, ServiceContext } from './context';

/** The methods src/main/index.ts answers itself, because they show a dialog, or open a folder, a file or a link on the desktop. */
export const DESKTOP_METHODS = [
  'pickDirectory',
  'pickFile',
  'importEnvFile',
  'openClientFolder',
  'openTaskWorktree',
  'openLink',
  'openInEditor',
  'openTaskInEditor',
  'openClientFileInEditor',
  'openTaskNotesInEditor',
  'openTaskOutputInEditor',
  'openAreaInEditor',
] as const satisfies readonly (keyof HatstandApi)[];

export type DesktopMethod = (typeof DESKTOP_METHODS)[number];

/** Every method of the API that works without Electron. */
export type ServiceApi = Omit<HatstandApi, DesktopMethod>;

/** What the services use from the parts that run processes or timers. The composition root passes the real ones; a test passes fakes. */
export type ServiceDeps = PreferenceServiceDeps & {
  protection: RepoProtection;
  sessions: Pick<
    SessionManager,
    | 'start'
    | 'resume'
    | 'stop'
    | 'write'
    | 'sendDraft'
    | 'resize'
    | 'readBuffer'
    | 'readOutput'
    | 'readSubagents'
    | 'refreshSummary'
    | 'sendPrompt'
    | 'changeGuide'
    | 'moveGuideStep'
    | 'hasLiveSession'
    | 'hasLiveClientSession'
  >;
  signIn: Pick<AgentSignIn, 'start' | 'has' | 'write' | 'resize' | 'readBuffer' | 'readOutput'>;
  checkAgent: typeof checkAgent;
  reviews: Pick<ReviewMonitor, 'all' | 'check' | 'checkAll' | 'get' | 'failureLogs'>;
  suggester: Pick<DescriptionSuggester, 'suggest' | 'cancel' | 'instructionsFor'>;
  windows: NewTaskWindows;
  installedApp: InstalledApp;
};

type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void ? I : never;

/** Joins handlers into one API. A method handled twice is a mistake in the wiring, so it fails at once instead of one handler quietly replacing the other. */
export function combineHandlers<const Parts extends readonly object[]>(...parts: Parts): UnionToIntersection<Parts[number]> {
  const combined: Record<string, unknown> = {};
  for (const part of parts) {
    for (const [method, handler] of Object.entries(part)) {
      if (Object.hasOwn(combined, method)) throw new Error(`${method} is handled twice.`);
      combined[method] = handler;
    }
  }
  return combined as UnionToIntersection<Parts[number]>;
}

/** Each service, before they are joined, so a test can see which one handles what. */
export function serviceParts(ctx: ServiceContext, deps: ServiceDeps) {
  const copies = createCodeCopies(ctx);
  const { protection, sessions } = deps;
  return {
    workspace: createWorkspaceService(ctx, deps),
    clients: createClientService(ctx, { sessions, copies }),
    repositories: createRepositoryService(ctx),
    accounts: createAccountService(ctx, deps),
    planning: createPlanningService(ctx, { protection }),
    tasks: createTaskService(ctx, { sessions, copies, suggester: deps.suggester }),
    backlog: createBacklogService(ctx),
    reviews: createReviewService(ctx, deps),
    sessions: createSessionService(deps),
    guides: createGuideService(ctx, deps),
    guard: createGuardService(ctx, { protection }),
    secrets: createSecretService(ctx),
    clientFiles: createClientFileService(ctx, { protection }),
    changes: createChangeService(ctx),
    gitIdentity: createGitIdentityService(ctx),
    preferences: createPreferenceService(ctx, deps),
    newTaskDrafts: createNewTaskDraftService(ctx, deps),
    release: createReleaseService(ctx, deps),
  };
}

export function createServices(ctx: ServiceContext, deps: ServiceDeps): ServiceApi {
  const parts = serviceParts(ctx, deps);
  return combineHandlers(
    parts.workspace,
    parts.clients,
    parts.repositories,
    parts.accounts,
    parts.planning,
    parts.tasks,
    parts.backlog,
    parts.reviews,
    parts.sessions,
    parts.guides,
    parts.guard,
    parts.secrets,
    parts.clientFiles,
    parts.changes,
    parts.gitIdentity,
    parts.preferences,
    parts.newTaskDrafts,
    parts.release,
  );
}
