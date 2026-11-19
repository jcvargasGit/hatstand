const ROW_WIDTHS = ['42%', '58%', '36%', '64%', '48%', '54%', '40%'];

/** Holds the place of the list of repositories while Hatstand asks for it, so the screen keeps its shape. */
export function RepoListSkeleton() {
  return (
    <div className="repo-selection" role="status" aria-busy="true">
      <span className="visually-hidden">Listing repositories</span>
      <div className="selection-actions">
        <div className="skeleton skeleton-text" style={{ width: '38%' }} />
        <div className="skeleton skeleton-button" style={{ width: 150 }} />
      </div>
      <div className="skeleton skeleton-field is-wide" />
      <div className="selection-actions">
        <div className="skeleton skeleton-button" style={{ width: 86 }} />
        <div className="skeleton skeleton-button" style={{ width: 62 }} />
      </div>
      <ul className="repo-list repo-list-skeleton" aria-hidden="true">
        {ROW_WIDTHS.map((width) => (
          <li key={width}>
            <div className="skeleton skeleton-text" style={{ width }} />
          </li>
        ))}
      </ul>
      <div className="skeleton skeleton-field" />
      <div className="skeleton skeleton-button" />
    </div>
  );
}
