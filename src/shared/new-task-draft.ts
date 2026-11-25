import { z } from 'zod';
import { taskPrioritySchema } from './schemas';

/** A task being written: everything the New task form holds, so it can move to a window of its own and lose nothing. */
export const newTaskDraftSchema = z.object({
  title: z.string().default(''),
  description: z.string().default(''),
  companyId: z.string(),
  playbookId: z.string().default(''),
  areaId: z.string().default(''),
  accountId: z.string().default(''),
  priority: taskPrioritySchema.default('none'),
  isolated: z.boolean().default(true),
  projectIds: z.array(z.string()).default([]),
  /** The person chose the guide, so the suggested one no longer replaces it. */
  guideChosen: z.boolean().default(false),
  /** The person chose the area, so the suggested one no longer replaces it. */
  areaChosen: z.boolean().default(false),
  /** The backlog item this form turns into a task. Without it, saving creates a new task. */
  ideaId: z.string().optional(),
  /** The draft this form is saved as in the backlog, once it has one. */
  draftId: z.string().optional(),
  /** The key of the description suggestion of this form, kept with the draft. */
  suggestionKey: z.string().optional(),
});

/** The title a draft has in the backlog while the person has written none. */
export const UNTITLED_DRAFT = 'Untitled draft';

/** Whether the form holds something worth keeping as a draft. */
export const hasDraftText = (draft: Pick<NewTaskDraft, 'title' | 'description'>): boolean => draft.title.trim() !== '' || draft.description.trim() !== '';

export type NewTaskDraft = z.infer<typeof newTaskDraftSchema>;
