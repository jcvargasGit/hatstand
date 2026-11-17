export const FLAG_CHOICES = ['🚩', '⭐', '🔥', '⚠️', '👀', '✅', '💡', '🐛'];

export type MenuPoint = { x: number; y: number };

const firstSymbol = (text: string): string => {
  if (typeof Intl.Segmenter !== 'function') return Array.from(text)[0] ?? '';
  const [first] = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text);
  return first?.segment ?? '';
};

export function flagFrom(text: string): string {
  return firstSymbol(text.trim());
}

export function menuPlace(point: MenuPoint, menu: { width: number; height: number }, viewport: { width: number; height: number }, margin = 8): MenuPoint {
  const fit = (start: number, size: number, limit: number) => Math.max(margin, Math.min(start, limit - size - margin));
  return { x: fit(point.x, menu.width, viewport.width), y: fit(point.y, menu.height, viewport.height) };
}
