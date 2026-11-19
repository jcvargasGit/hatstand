import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

const MOVE_MS = 180;
const LEAVE_MS = 140;
const ARRIVED_CLASS = 'motion-arrived';
/** How long a row that left stays hidden while the list reads the change that removes it. */
const HIDDEN_AFTER_LEAVE_MS = 600;

type Place = { top: number; group: string | undefined };

function canAnimate(): boolean {
  if (typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function' || typeof ResizeObserver === 'undefined') return false;
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function items(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-motion-key]')];
}

function markArrived(element: HTMLElement): void {
  element.classList.remove(ARRIVED_CLASS);
  // Reading the size restarts the animation when the same row arrives twice in a row.
  void element.offsetWidth;
  element.classList.add(ARRIVED_CLASS);
  element.addEventListener('animationend', () => element.classList.remove(ARRIVED_CLASS), { once: true });
}

/**
 * Shows where the items of a list go when it changes, so nothing jumps: an item that changes place slides
 * there, a new one fades in, and `leave` fades one out before the change that removes it.
 *
 * An item is any element inside the container with `data-motion-key`. `data-motion-group` names the group it
 * is in, and an item that changes group is marked for a moment where it lands.
 * A change of `quietKey`, such as the text of a filter, moves the items at once.
 * `mounted` says whether the container is on the page, for a list that is not drawn while it is empty.
 */
export function useListMotion(container: RefObject<HTMLElement | null>, quietKey: string, mounted = true) {
  const places = useRef<Map<string, Place> | null>(null);
  const quiet = useRef(false);
  const lastQuietKey = useRef(quietKey);

  const sync = useCallback(
    (animate: boolean) => {
      const root = container.current;
      if (!root) return;
      const origin = root.getBoundingClientRect().top;
      const before = places.current;
      const now = new Map<string, Place>();
      for (const element of items(root)) {
        const key = element.dataset.motionKey ?? '';
        const place = { top: element.getBoundingClientRect().top - origin, group: element.dataset.motionGroup };
        now.set(key, place);
        if (!animate || !before) continue;
        const was = before.get(key);
        if (!was) {
          element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MOVE_MS, easing: 'ease-out' });
          if (place.group !== undefined) markArrived(element);
          continue;
        }
        const moved = was.top - place.top;
        if (Math.abs(moved) > 1) {
          element.animate([{ transform: `translateY(${moved}px)` }, { transform: 'none' }], { duration: MOVE_MS, easing: 'ease-out' });
        }
        if (was.group !== place.group) markArrived(element);
      }
      places.current = now;
    },
    [container],
  );

  useLayoutEffect(() => {
    if (lastQuietKey.current === quietKey) return;
    lastQuietKey.current = quietKey;
    quiet.current = true;
    // The list reports its change right after this, so the mark is dropped once that report has passed.
    queueMicrotask(() => {
      if (quiet.current) sync(false);
      quiet.current = false;
    });
  }, [quietKey, sync]);

  useEffect(() => {
    const root = container.current;
    if (!mounted || !root || !canAnimate()) return;
    places.current = null;
    sync(false);
    const onChange = new MutationObserver(() => {
      sync(!quiet.current);
      quiet.current = false;
    });
    onChange.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-motion-group'] });
    const onResize = new ResizeObserver(() => sync(false));
    onResize.observe(root);
    return () => {
      onChange.disconnect();
      onResize.disconnect();
    };
  }, [container, sync, mounted]);

  /** Fades out the item and what belongs to it (keys that start with its key and a colon), then runs the change. */
  const leave = useCallback(
    async (key: string, change: () => Promise<void>) => {
      const root = container.current;
      const leaving = root && canAnimate() ? items(root).filter((element) => element.dataset.motionKey === key || element.dataset.motionKey?.startsWith(`${key}:`)) : [];
      const fades = leaving.map((element) => element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: LEAVE_MS, easing: 'ease-in', fill: 'forwards' }));
      const show = () => fades.forEach((fade) => fade.cancel());
      await Promise.all(fades.map((fade) => fade.finished.catch(() => undefined)));
      try {
        await change();
      } catch (error) {
        show();
        throw error;
      }
      setTimeout(show, HIDDEN_AFTER_LEAVE_MS);
    },
    [container],
  );

  return { leave };
}
