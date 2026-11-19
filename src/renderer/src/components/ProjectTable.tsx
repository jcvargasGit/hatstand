import { useRef, useState } from 'react';
import type { Company } from '../../../shared/schemas';
import { useListMotion } from '../hooks/useListMotion';
import { groupProjectsByArea } from '../lib/project-groups';
import { ProjectRow } from './ProjectRow';

type ProjectTableProps = {
  company: Company;
  onSave: (company: Company) => Promise<void>;
  onChanged: () => Promise<void>;
};

export function ProjectTable({ company, onSave, onChanged }: ProjectTableProps) {
  const [filter, setFilter] = useState('');
  const table = useRef<HTMLTableElement>(null);
  const hasProjects = company.projects.length > 0;
  const { leave } = useListMotion(table, filter, hasProjects);
  if (!hasProjects) return null;
  const groups = groupProjectsByArea(company, filter);

  return (
    <div className="project-list">
      <input aria-label="Filter the repositories of this client" placeholder="Filter by name" value={filter} onChange={(event) => setFilter(event.target.value)} />
      {groups.length === 0 && <p className="hint">No repository matches this filter.</p>}
      <table className="project-table" ref={table} hidden={groups.length === 0}>
        <thead>
          <tr>
            <th scope="col">Repository</th>
            <th scope="col">Area</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {/* One flat list, so a repository that changes area keeps its row and its state. */}
          {groups.flatMap((group) => [
            <tr key={`group:${group.id}`} className="project-group" data-motion-key={`group:${group.id}`}>
              <th scope="colgroup" colSpan={3}>
                {group.title}
                <span className="board-count">{group.projects.length}</span>
              </th>
            </tr>,
            ...group.projects.map((project) => (
              <ProjectRow key={project.id} company={company} project={project} group={group.id} onSave={onSave} onChanged={onChanged} onLeave={(change) => leave(project.id, change)} />
            )),
          ])}
        </tbody>
      </table>
    </div>
  );
}
