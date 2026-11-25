import type { FlagChoice } from './schemas';

export const MAX_FLAGS = 24;

/** The flags a task can get before the person changes the list. */
export const DEFAULT_FLAGS: FlagChoice[] = [
  { emoji: '🚩', name: 'Flagged' },
  { emoji: '⭐', name: 'Important' },
  { emoji: '🔥', name: 'Urgent' },
  { emoji: '⚠️', name: 'Careful' },
  { emoji: '👀', name: 'To review' },
  { emoji: '✅', name: 'Ready' },
  { emoji: '💡', name: 'Idea' },
  { emoji: '🐛', name: 'Bug' },
];

/** The list as it can be saved: no empty flag, each emoji once, and no more than the menu has room for. */
export function cleanFlags(flags: FlagChoice[]): FlagChoice[] {
  const seen = new Set<string>();
  const kept = flags
    .map((flag) => ({ emoji: flag.emoji.trim(), name: flag.name.trim() }))
    .filter((flag) => {
      if (!flag.emoji || seen.has(flag.emoji)) return false;
      seen.add(flag.emoji);
      return true;
    });
  return kept.slice(0, MAX_FLAGS);
}

/** The list with one more emoji, such as one the person typed in the menu. Unchanged when it is there already or the list is full. */
export function withFlag(flags: FlagChoice[], emoji: string): FlagChoice[] {
  if (!emoji || flags.length >= MAX_FLAGS || flags.some((flag) => flag.emoji === emoji)) return flags;
  return [...flags, { emoji, name: '' }];
}

export const flagLabel = (flag: FlagChoice): string => (flag.name ? `${flag.emoji} ${flag.name}` : flag.emoji);
