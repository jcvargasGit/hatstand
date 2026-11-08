import { useState } from 'react';
import type { Company, Project } from '../../../shared/schemas';
import { workRepositories } from '../../../shared/work-repos';

type RepoPickerProps = {
  company: Company;
  selected: string[];
  onChange: (projectIds: string[]) => void;
  hint?: string;
  changing?: string[];
};

const FILTER_FROM = 8;

export function RepoPicker({ company, selected, onChange, hint = 'Select where this work lives, so the agent knows what to read. It only reads them. When it needs to change one, it makes a copy on its own branch, and that copy shows up in Changes.', changing = [] }: RepoPickerProps) {
  const [filter, setFilter] = useState('');
  const term = filter.trim().toLowerCase();
  const repos = workRepositories(company);
  const shown = repos.filter((project) => project.name.toLowerCase().includes(term));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  const addSubdomain = (subdomainId: string) => {
    const folders = company.subdomains.find((subdomain) => subdomain.id === subdomainId)?.folders ?? [];
    const ids = repos.filter((project) => project.subdomainId === subdomainId || folders.some((folder) => folder.projectId === project.id)).map((project) => project.id);
    onChange([...new Set([...selected, ...ids])]);
  };
  const subdomains = company.subdomains.filter((subdomain) => subdomain.folders.length > 0 || repos.some((project) => project.subdomainId === subdomain.id));

  const column = (title: string, projects: Project[], empty: string) => (
    <section className="repo-column" aria-label={title}>
      <h4>
        {title}
        <span className="board-count">{projects.length}</span>
      </h4>
      {projects.length === 0 ? (
        <p className="hint">{empty}</p>
      ) : (
        <ul className="repo-picker-list">
          {projects.map((project) => (
            <li key={project.id}>
              <label title={project.path}>
                <input type="checkbox" checked={selected.includes(project.id)} disabled={changing.includes(project.id)} onChange={() => toggle(project.id)} />
                {project.name}
              </label>
              {changing.includes(project.id) && <span className="repo-chip">Changing</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <fieldset className="repo-picker">
      <legend>Repositories</legend>
      <p className="hint">{hint}</p>
      {subdomains.length > 0 && (
        <div className="repo-picker-groups">
          {subdomains.map((subdomain) => (
            <button key={subdomain.id} type="button" className="quiet" onClick={() => addSubdomain(subdomain.id)}>
              Add {subdomain.name}
            </button>
          ))}
          {selected.length > 0 && (
            <button type="button" className="quiet" onClick={() => onChange([])}>
              Clear
            </button>
          )}
        </div>
      )}
      {repos.length >= FILTER_FROM && (
        <input aria-label="Filter repositories" placeholder="Filter by name" value={filter} onChange={(event) => setFilter(event.target.value)} />
      )}
      <div className="repo-columns">
        {column('Not selected', shown.filter((project) => !selected.includes(project.id)), term ? 'None match this filter.' : 'Every repository is selected.')}
        {column('Selected', shown.filter((project) => selected.includes(project.id)), term ? 'None match this filter.' : 'Check a repository to move it here.')}
      </div>
    </fieldset>
  );
}
