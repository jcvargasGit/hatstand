import type { Idea } from '../../../shared/schemas';

type InboxPreviewProps = {
  ideas: Idea[];
};

export function InboxPreview({ ideas }: InboxPreviewProps) {
  return (
    <div className="inbox-preview">
      <p className="inbox-preview-title">What will be added</p>
      <ul aria-label="Tasks to add">
        {ideas.map((idea, index) => (
          <li key={index}>
            <span className="inbox-preview-task">{idea.title}</span>
            {idea.description && !idea.title.endsWith('…') && <small>{idea.description}</small>}
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
