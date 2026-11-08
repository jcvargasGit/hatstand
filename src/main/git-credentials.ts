import { gitOrigin, gitTokenName } from '../shared/git-source';
import type { GitSource } from '../shared/schemas';

export function credentialHelper(provider: GitSource['provider'], tokenVariable: string): string {
  const username = provider === 'github' ? 'x-access-token' : 'oauth2';
  return `!f() { test "$1" = get && printf 'username=${username}\\npassword=%s\\n' "$${tokenVariable}"; }; f`;
}

export const hiddenSecretName = (name: string) => `HATSTAND_${name}`;

export function hideSecrets(secrets: Record<string, string>, hidden: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(secrets).map(([name, value]) => [hidden.includes(name) ? hiddenSecretName(name) : name, value]));
}

export function sessionGitEnv(source: GitSource | undefined, secrets: Record<string, string>, hidden: string[] = []): Record<string, string> {
  if (!source) return {};
  const tokenVariable = gitTokenName(source.provider);
  if (!secrets[tokenVariable]) return {};
  const key = `credential.${gitOrigin(source)}.helper`;
  return {
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: key,
    GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: key,
    GIT_CONFIG_VALUE_1: credentialHelper(source.provider, hidden.includes(tokenVariable) ? hiddenSecretName(tokenVariable) : tokenVariable),
  };
}
