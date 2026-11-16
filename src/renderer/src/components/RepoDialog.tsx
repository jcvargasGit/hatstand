import { X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import type { Company } from '../../../shared/schemas';
import { RepoPicker } from './RepoPicker';

type RepoDialogProps = {
  company: Company;
  selected: string[];
  changing?: string[];
  onChoose: (projectIds: string[]) => void;
  onClose: () => void;
};

/** Choosing the repositories of a task in a window over the form, so the form keeps its place. */
export function RepoDialog({ company, selected, changing = [], onChoose, onClose }: RepoDialogProps) {
  const [chosen, setChosen] = useState(selected);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    event.preventDefault();
    onClose();
  };

  return (
    <div className="palette-backdrop repo-dialog-backdrop" onMouseDown={onClose}>
      <div className="suggestion-dialog repo-dialog" role="dialog" aria-modal="true" aria-label="Choose repositories" onKeyDown={onKeyDown} onMouseDown={(event) => event.stopPropagation()}>
        <div className="suggestion-head">
          <h3>Choose repositories</h3>
          <button type="button" className="quiet" aria-label="Close" title="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="suggestion-body">
          <RepoPicker company={company} selected={chosen} changing={changing} onChange={setChosen} />
        </div>
        <div className="inline-form suggestion-actions">
          <button
            type="button"
            autoFocus
            onClick={() => {
              onChoose(chosen);
              onClose();
            }}
          >
            {chosen.length === 0 ? 'Use no repository' : chosen.length === 1 ? 'Use this repository' : `Use these ${chosen.length} repositories`}
          </button>
          <button type="button" className="quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
