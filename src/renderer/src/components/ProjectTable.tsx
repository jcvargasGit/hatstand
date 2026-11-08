import type { Company } from '../../../shared/schemas';
import { ProjectRow } from './ProjectRow';

type ProjectTableProps = {
  company: Company;
  onSave: (company: Company) => Promise<void>;
  onChanged: () => Promise<void>;
};

export function ProjectTable({ company, onSave, onChanged }: ProjectTableProps) {
  if (company.projects.length === 0) return null;

  return (
    <table className="project-table">
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
        {company.projects.map((project) => (
          <ProjectRow key={project.id} company={company} project={project} onSave={onSave} onChanged={onChanged} />
        ))}
      </tbody>
    </table>
  );
}
