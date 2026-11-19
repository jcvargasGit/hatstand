import type { Idea } from '../../../shared/schemas';

type InboxPreviewProps = {
  ideas: Idea[];
  /** Shows every description in full, with its lines, as when all the text becomes one task. */
  whole?: boolean;
};

export function InboxPreview({ ideas, whole = false }: InboxPreviewProps) {
  return (
    <div className="inbox-preview">
      <p className="inbox-preview-title">What will be added</p>
      <ul aria-label="Tasks to add">
        {ideas.map((idea, index) => (
          <li key={index}>
            <span className="inbox-preview-task">{idea.title}</span>
            {idea.description && (whole || !idea.title.endsWith('…')) && <small className={whole ? 'inbox-preview-whole' : undefined}>{idea.description}</small>}
            {(idea.checklist?.length ?? 0) > 0 && (
              <ul aria-label={`Checklist of ${idea.title}`} className="inbox-preview-checklist">
                {idea.checklist?.map((item, itemIndex) => (
                  <li key={itemIndex}>{item}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
