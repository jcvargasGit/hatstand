import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { FlagChoice, Task } from '../../../shared/schemas';
import { flagLabel } from '../../../shared/task-flags';
import { flagFrom, menuPlace, type MenuPoint } from '../lib/task-flag';

type TaskFlagMenuProps = {
  task: Task;
  /** The flags to offer, in order. */
  flags: FlagChoice[];
  at: MenuPoint;
  onPick: (flag: string) => void;
  /** Told when the person types an emoji that is not in the list, so it is there the next time. */
  onAdd?: (flag: string) => void;
  onClose: () => void;
};

export function TaskFlagMenu({ task, flags, at, onPick, onAdd, onClose }: TaskFlagMenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState(at);
  const [other, setOther] = useState('');

  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect();
    if (box) setPlace(menuPlace(at, box, { width: window.innerWidth, height: window.innerHeight }));
  }, [at]);

  useEffect(() => {
    const previous = document.activeElement;
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"], [role="menuitemradio"]')?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) onClose();
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, [onClose]);

  const pick = (flag: string) => {
    onPick(flag);
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.target instanceof HTMLInputElement || !['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const stops = [...(menu.current?.querySelectorAll<HTMLElement>('button, input') ?? [])];
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next = (stops.indexOf(document.activeElement as HTMLElement) + step + stops.length) % stops.length;
    stops[next]?.focus();
  };

  const typed = flagFrom(other);

  return (
    <div ref={menu} className="flag-menu" role="menu" aria-label={`Flag for ${task.title}`} style={{ left: place.x, top: place.y }} onKeyDown={onKeyDown}>
      <div className="flag-menu-choices">
        {flags.map((flag) => (
          <button key={flag.emoji} type="button" role="menuitemradio" aria-checked={task.flag === flag.emoji} aria-label={`Flag with ${flagLabel(flag)}`} title={flag.name || undefined} onClick={() => pick(flag.emoji)}>
            {flag.emoji}
          </button>
        ))}
      </div>
      <input
        className="flag-menu-other"
        aria-label="Other emoji"
        placeholder="Other emoji, then Enter"
        title="It is added to this list. Change the list in Settings."
        value={other}
        onChange={(event) => setOther(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !typed) return;
          if (!flags.some((flag) => flag.emoji === typed)) onAdd?.(typed);
          pick(typed);
        }}
      />
      {task.flag && (
        <button type="button" className="flag-menu-remove" role="menuitem" onClick={() => pick('')}>
          Remove flag
        </button>
      )}
    </div>
  );
}
