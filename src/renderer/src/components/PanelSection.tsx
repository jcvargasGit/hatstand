import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

type PanelSectionProps = {
  title: string;
  open: boolean;
  onToggle: () => void;
  className?: string;
  /** Shown beside the title, such as a count or a button. */
  actions?: ReactNode;
  children: ReactNode;
};

/** One section of the panel beside the terminal. Its title folds it away, and its content scrolls inside it. */
export function PanelSection({ title, open, onToggle, className, actions, children }: PanelSectionProps) {
  return (
    <section className={['panel-section', className, open ? null : 'is-closed'].filter(Boolean).join(' ')} aria-label={title}>
      <div className="panel-section-head">
        <h3>
          <button type="button" className="link-button" aria-expanded={open} onClick={onToggle}>
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {title}
          </button>
        </h3>
        {open && actions}
      </div>
      {open && <div className="panel-section-body">{children}</div>}
    </section>
  );
}
