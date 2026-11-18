import type { HatstandEvents } from '../../shared/api';
import type { DataPaths } from '../paths';
import type { SecretStore } from '../secrets';
import type { ShellTools } from '../shell';
import type { Store } from '../store';

/** Tells every window about a change. The composition root sends it through Electron; a test can record it. */
export type Emit = <E extends keyof HatstandEvents>(event: E, payload: HatstandEvents[E]) => void;

/**
 * What the services share. Only src/main/index.ts builds it, so no service imports Electron,
 * and a test builds one from a throwaway Store and fakes.
 */
export type ServiceContext = {
  store: Store;
  paths: DataPaths;
  secrets: Pick<SecretStore, 'read' | 'merge' | 'names' | 'remove' | 'list' | 'recordCheck' | 'clearRejection' | 'setNote'>;
  tools: ShellTools;
  emit: Emit;
  /** The person's home folder, where ~ points, and where git keeps its settings. A test passes a throwaway one. */
  userHome: string;
  /** Reaches GitHub, GitLab, and photo links. A test passes a fake, so it never reaches the network. */
  fetch: typeof fetch;
};
