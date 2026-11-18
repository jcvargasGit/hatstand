// The environment an agent starts with: the client's secrets, its git credentials and identity, the
// Hatstand tools first on the PATH, and the variables each session module hands over.
import type { Company } from '../shared/schemas';
import type { AgentAdapter } from './agents/types';
import { buildAgentEnv } from './env';
import { hideSecrets, sessionGitEnv } from './git-credentials';
import { identityEnv } from './git-identity';
import type { DataPaths } from './paths';
import type { SecretStore } from './secrets';
import type { Store } from './store';

/** Lets the commit check know the latest secrets of a client. The composition root passes the one the services share. */
export type FingerprintRefresher = { refreshFingerprints(company: Company): void };

export type SessionEnvInput = {
  company: Company;
  adapter: Pick<AgentAdapter, 'hiddenSecrets'>;
  /** Variables of the session modules that the agent adapter may replace. */
  before: Record<string, string>;
  /** The variables of the agent adapter. */
  launchEnv: Record<string, string>;
  /** Variables of the session modules that always win. */
  after: Record<string, string>;
};

export class SessionEnv {
  constructor(
    private readonly paths: DataPaths,
    private readonly store: Store,
    private readonly secrets: Pick<SecretStore, 'read'>,
    private readonly shellPath: string,
    private readonly protection: FingerprintRefresher,
  ) {}

  /** Builds the environment of a session. The commit check learns the client's secrets first, so it can stop them before the agent can commit them. */
  build({ company, adapter, before, launchEnv, after }: SessionEnvInput): Record<string, string> {
    this.protection.refreshFingerprints(this.store.readCompany(company.id));
    const secrets = this.secrets.read(company.id);
    const hiddenSecrets = adapter.hiddenSecrets ?? [];
    return buildAgentEnv({
      base: process.env,
      path: `${this.paths.toolsDir}:${this.shellPath}`,
      secrets: hideSecrets(secrets, hiddenSecrets),
      extra: { ...sessionGitEnv(company.gitSource, secrets, hiddenSecrets), ...identityEnv(company.gitIdentity), ...before, ...launchEnv, ...after },
    });
  }
}
