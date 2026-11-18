import { keyServiceName, knownKey } from './known-keys';
import type { KeyInfo } from './schemas';

export type KeyState = 'rejected' | 'expired' | 'expires-soon' | 'valid' | 'unchecked';

const DAY_MS = 24 * 60 * 60 * 1000;
export const EXPIRES_SOON_DAYS = 14;

type Checked = Pick<KeyInfo, 'check'>;

/** The expiry of a key, unless the file holds something that is not a date. */
const readableExpiry = (check: Checked['check']): string | undefined =>
  check?.expiresAt && !Number.isNaN(Date.parse(check.expiresAt)) ? check.expiresAt : undefined;

export function keyState({ check }: Checked, now: Date): KeyState {
  if (!check) return 'unchecked';
  if (check.result === 'rejected') return 'rejected';
  const expiresAt = readableExpiry(check);
  if (!expiresAt) return 'valid';
  const left = Date.parse(expiresAt) - now.getTime();
  if (left <= 0) return 'expired';
  return left <= EXPIRES_SOON_DAYS * DAY_MS ? 'expires-soon' : 'valid';
}

export const hasKeyProblem = (key: Checked, now: Date): boolean => ['rejected', 'expired', 'expires-soon'].includes(keyState(key, now));

export const shownDay = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

function daysLeft(expiresAt: string, now: Date): string {
  const days = Math.floor((Date.parse(expiresAt) - now.getTime()) / DAY_MS);
  if (days <= 0) return 'Expires today';
  return days === 1 ? 'Expires tomorrow' : `Expires in ${days} days`;
}

/** The few words a key shows about its state. Empty when Hatstand has not asked the provider. */
export function keyStateLabel(key: Checked, now: Date): string {
  const state = keyState(key, now);
  const expiresAt = readableExpiry(key.check);
  if (state === 'rejected') return 'Rejected';
  if (state === 'expired' && expiresAt) return `Expired on ${shownDay(expiresAt)}`;
  if (state === 'expires-soon' && expiresAt) return daysLeft(expiresAt, now);
  if (state === 'valid') return expiresAt ? `Valid until ${shownDay(expiresAt)}` : 'Valid';
  return '';
}

/** What to do about a key that stopped working, or is about to. Empty when there is nothing to do. */
export function keyProblemAdvice(key: Pick<KeyInfo, 'name' | 'check'>, now: Date): string {
  const state = keyState(key, now);
  const known = knownKey(key.name);
  const service = known ? keyServiceName(known.service) : 'The provider';
  if (state === 'rejected') {
    return known?.needs
      ? `${service} rejected it. Check ${known.needs.join(' and ')}, or replace this token.`
      : `${service} rejected it. Create a new token and replace this one.`;
  }
  if (state === 'expired') return 'Create a new token and replace this one.';
  if (state === 'expires-soon') return 'Create a new token and replace this one before it stops working.';
  return '';
}
