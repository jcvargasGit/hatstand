import type { Session, SessionState } from './schemas';

export const DRAFT_IN_THE_WAY = 'Your text is still in the terminal. Send it or clear it first.';

export function summaryBlockedReason(state: SessionState | undefined, hasDraft: Session['draft'] = false): string | null {
  if (state === undefined || state === 'stopped') return 'Resume the session to update the TL;DR.';
  if (state === 'working' || state === 'needs-input') return 'The agent is busy or asking you something. Try again when it is waiting at its prompt.';
  return hasDraft ? DRAFT_IN_THE_WAY : null;
}
