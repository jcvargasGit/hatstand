export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export const baseLabel = (base: string) => (base === 'HEAD' ? 'the commit the repository was on' : base);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function timeAgo(when: string, now = Date.now()): string {
  const elapsed = now - Date.parse(when);
  if (Number.isNaN(elapsed)) return '';
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${plural(Math.floor(elapsed / MINUTE), 'minute', 'minutes')} ago`;
  if (elapsed < DAY) return `${plural(Math.floor(elapsed / HOUR), 'hour', 'hours')} ago`;
  return `${plural(Math.floor(elapsed / DAY), 'day', 'days')} ago`;
}
