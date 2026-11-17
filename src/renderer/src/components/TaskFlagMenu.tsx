import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Task } from '../../../shared/schemas';
import { FLAG_CHOICES, flagFrom, menuPlace, type MenuPoint } from '../lib/task-flag';

type TaskFlagMenuProps = {
  task: Task;
  at: MenuPoint;
  onPick: (flag: string) => void;
  onClose: () => void;
};

export function TaskFlagMenu({ task, at, onPick, onClose }: TaskFlagMenuProps) {
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
        {FLAG_CHOICES.map((flag) => (
          <button key={flag} type="button" role="menuitemradio" aria-checked={task.flag === flag} aria-label={`Flag with ${flag}`} onClick={() => pick(flag)}>
            {flag}
          </button>
        ))}
      </div>
      <input
        className="flag-menu-other"
        aria-label="Other emoji"
        placeholder="Other emoji, then Enter"
        value={other}
        onChange={(event) => setOther(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && typed) pick(typed);
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
