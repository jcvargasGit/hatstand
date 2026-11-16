import { ChevronDown, ChevronRight } from 'lucide-react';
import type { HTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import type { Company } from '../../../shared/schemas';
import { ClientAvatar } from './ClientAvatar';

type ClientTreeBranchProps = {
  company: Company;
  /** Names the branch, such as "Acme tasks". */
  label: string;
  open: boolean;
  current?: boolean;
  count: number;
  countLabel: string;
  /** Buttons after the name, such as documents and settings. */
  actions?: ReactNode;
  /** Dragging the row to reorder clients, where the list allows it. */
  rowProps?: HTMLAttributes<HTMLDivElement>;
  nameTitle?: string;
  children: ReactNode;
  onToggle: () => void;
  onOpen: () => void;
  onNameKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
};

/** A client in the sidebar, with its tasks nested under it. Every list of clients in the sidebar uses it. */
export function ClientTreeBranch({ company, label, open, current = false, count, countLabel, actions, rowProps, nameTitle, children, onToggle, onOpen, onNameKeyDown }: ClientTreeBranchProps) {
  return (
    <section className="tree-client" aria-label={label}>
      <div {...rowProps} className={`tree-client-row ${rowProps?.className ?? ''}`.trim()} aria-current={current ? 'page' : undefined}>
        <button className="tree-toggle" aria-label={`${open ? 'Collapse' : 'Expand'} ${company.name}`} aria-expanded={open} onClick={onToggle}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <button className="tree-client-name" title={nameTitle} onClick={onOpen} onKeyDown={onNameKeyDown}>
          <ClientAvatar company={company} size="small" />
          <span className="nav-name">{company.name}</span>
          {count > 0 && (
            <span className="nav-count" aria-label={countLabel}>
              {count}
            </span>
          )}
        </button>
        {actions}
      </div>
      {open && <div className="tree-tasks">{children}</div>}
    </section>
  );
}
