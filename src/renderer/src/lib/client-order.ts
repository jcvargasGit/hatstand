export function moveClient(ids: string[], moving: string, target: string): string[] {
  if (moving === target || !ids.includes(moving) || !ids.includes(target)) return ids;
  const without = ids.filter((id) => id !== moving);
  const movingDown = ids.indexOf(moving) < ids.indexOf(target);
  const at = without.indexOf(target) + (movingDown ? 1 : 0);
  return [...without.slice(0, at), moving, ...without.slice(at)];
}
