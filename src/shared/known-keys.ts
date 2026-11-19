import { tokenPageUrl } from './git-source';
import type { GitSource } from './schemas';

export type KeyServiceId = 'jira' | 'github' | 'gitlab';

export type KnownKey = {
  name: string;
  service: KeyServiceId;
  purpose: string;
  /** A token Hatstand can ask its provider about. The other known keys are settings, such as an address. */
  isToken: boolean;
  /** Shown only when it is saved, because another key does the same job. */
  isAlias?: boolean;
  /** The other keys the provider needs before this one can be checked. */
  needs?: readonly string[];
};

export const KEY_SERVICES: readonly { id: KeyServiceId; name: string; permissions: string }[] = [
  { id: 'jira', name: 'Jira', permissions: 'An API token of your Atlassian account. It has the same access as you.' },
  { id: 'github', name: 'GitHub', permissions: 'The token needs the repo and read:org permissions.' },
  { id: 'gitlab', name: 'GitLab', permissions: 'The token needs the read_api and write_repository permissions.' },
];

const GIT_TOKEN_PURPOSE =
  'Brings in the issues assigned to you, lists and downloads repositories, signs git in during sessions, and reads pull requests for review.';

export const KNOWN_KEYS: readonly KnownKey[] = [
  { name: 'JIRA_SITE', service: 'jira', isToken: false, purpose: 'The address of your Jira, such as acme.atlassian.net.' },
  { name: 'JIRA_EMAIL', service: 'jira', isToken: false, purpose: 'The email of your Atlassian account.' },
  {
    name: 'JIRA_API_TOKEN',
    service: 'jira',
    isToken: true,
    needs: ['JIRA_SITE', 'JIRA_EMAIL'],
    purpose: 'Brings in the Jira issues assigned to you. It works only with JIRA_SITE and JIRA_EMAIL.',
  },
  { name: 'GITHUB_TOKEN', service: 'github', isToken: true, purpose: GIT_TOKEN_PURPOSE },
  { name: 'GH_TOKEN', service: 'github', isToken: true, isAlias: true, purpose: 'Used like GITHUB_TOKEN when that one is missing.' },
  { name: 'GITLAB_TOKEN', service: 'gitlab', isToken: true, purpose: GIT_TOKEN_PURPOSE },
  {
    name: 'GITLAB_URL',
    service: 'gitlab',
    isToken: false,
    purpose: 'The address of your GitLab. Hatstand saves it when you connect GitLab, and uses gitlab.com without it.',
  },
];

export const CUSTOM_KEY_PURPOSE = 'Given to agents as an environment variable in this client’s sessions.';

export const knownKey = (name: string): KnownKey | undefined => KNOWN_KEYS.find((key) => key.name === name);

export const keyServiceName = (id: KeyServiceId): string => KEY_SERVICES.find((service) => service.id === id)?.name ?? id;

export const keyServicePermissions = (id: KeyServiceId): string => KEY_SERVICES.find((service) => service.id === id)?.permissions ?? '';

/** The key a service signs in with, among the ones a client has. GitHub falls back to GH_TOKEN, as the rest of Hatstand does. */
export function serviceTokenName(service: KeyServiceId, savedNames: readonly string[]): string {
  if (service === 'jira') return 'JIRA_API_TOKEN';
  if (service === 'gitlab') return 'GITLAB_TOKEN';
  return savedNames.includes('GITHUB_TOKEN') || !savedNames.includes('GH_TOKEN') ? 'GITHUB_TOKEN' : 'GH_TOKEN';
}

export function canCheckKey(name: string, savedNames: readonly string[]): boolean {
  const key = knownKey(name);
  return Boolean(key?.isToken) && savedNames.includes(name) && (key?.needs ?? []).every((needed) => savedNames.includes(needed));
}

/** Where the person creates a new token. Null when the saved GitLab address cannot be used. */
export function renewalUrl(service: KeyServiceId, gitSource: Pick<GitSource, 'provider' | 'host'> | undefined): string | null {
  if (service === 'jira') return 'https://id.atlassian.com/manage-profile/security/api-tokens';
  try {
    return tokenPageUrl(gitSource?.provider === service ? gitSource : { provider: service });
  } catch {
    return null;
  }
}
