import type { Snapshot } from '../../../shared/api';
import type { NewTaskDraft } from '../../../shared/new-task-draft';
import type { Task } from '../../../shared/schemas';
import { workRepositories } from '../../../shared/work-repos';
import { choicesOf, newTaskChoices } from './task-form';

type Clients = Pick<Snapshot, 'accounts' | 'companies'>;

/** The form of a new task before anything is written. A guide given here counts as chosen, and an empty one means no guide. */
export function startDraft(snapshot: Clients, companyId: string, areaId?: string, playbookId?: string): NewTaskDraft {
  return {
    ...newTaskChoices(snapshot, companyId, areaId),
    title: '',
    description: '',
    playbookId: playbookId ?? '',
    guideChosen: playbookId !== undefined,
    areaChosen: Boolean(areaId),
  };
}

/**
 * The form filled in with a backlog item, which becomes the task when the form is saved.
 * A draft opens as the new task it was: with the choices the person had made, and saved again as they write.
 */
export function draftFromIdea(task: Task, snapshot: Clients): NewTaskDraft {
  if (task.draft) {
    return {
      ...choicesOf(task, snapshot),
      playbookId: task.draft.playbookId,
      title: task.draft.untitled ? '' : task.title,
      description: task.description,
      guideChosen: task.draft.guideChosen,
      areaChosen: task.draft.areaChosen,
      draftId: task.id,
      suggestionKey: task.draft.suggestionKey,
    };
  }
  return {
    ...choicesOf(task, snapshot),
    title: task.title,
    description: task.description,
    guideChosen: task.guide !== undefined,
    areaChosen: task.subdomainId !== undefined,
    ideaId: task.id,
  };
}

/**
 * A draft as it can be shown now. What was written always stays. A client, area or repository that no
 * longer exists is replaced by the choices of a new task, so the form never points at something gone.
 */
export function fitDraft(draft: NewTaskDraft, snapshot: Clients): NewTaskDraft {
  const company = snapshot.companies.find((item) => item.id === draft.companyId);
  if (!company) {
    const fallback = snapshot.companies[0]?.id ?? '';
    return { ...startDraft(snapshot, fallback), title: draft.title, description: draft.description };
  }
  const known = new Set(workRepositories(company).map((repo) => repo.id));
  const hasArea = company.subdomains.some((area) => area.id === draft.areaId);
  return {
    ...draft,
    projectIds: draft.projectIds.filter((id) => known.has(id)),
    areaId: hasArea ? draft.areaId : '',
    areaChosen: hasArea && draft.areaChosen,
  };
}
