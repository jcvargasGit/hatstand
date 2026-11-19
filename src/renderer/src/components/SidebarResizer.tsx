import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { clampSidebarWidth, SIDEBAR_KEY_STEP, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from '../lib/sidebar-width';

type SidebarResizerProps = {
  width: number;
  onResize: (width: number) => void;
  onReset: () => void;
};

type Drag = { startX: number; startWidth: number };

/** The edge of the sidebar: drag it, or use the arrow keys, to make the sidebar wider or narrower. */
export function SidebarResizer({ width, onResize, onReset }: SidebarResizerProps) {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  const pending = useRef(width);

  const cancelFrame = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };

  useEffect(() => cancelFrame, []);

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width };
    setDragging(true);
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    pending.current = clampSidebarWidth(drag.current.startWidth + event.clientX - drag.current.startX);
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      onResize(pending.current);
    });
  };

  const stop = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const finalWidth = clampSidebarWidth(drag.current.startWidth + event.clientX - drag.current.startX);
    drag.current = null;
    cancelFrame();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragging(false);
    onResize(finalWidth);
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const targets: Record<string, number> = {
      ArrowLeft: width - SIDEBAR_KEY_STEP,
      ArrowRight: width + SIDEBAR_KEY_STEP,
      Home: SIDEBAR_MIN_WIDTH,
      End: SIDEBAR_MAX_WIDTH,
    };
    const target = targets[event.key];
    if (target === undefined) return;
    event.preventDefault();
    onResize(clampSidebarWidth(target));
  };

  return (
    <div
      className={dragging ? 'sidebar-resizer is-dragging' : 'sidebar-resizer'}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={width}
      title="Drag to resize. Double-click for the usual width."
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={onReset}
      onKeyDown={onKey}
    />
  );
}
