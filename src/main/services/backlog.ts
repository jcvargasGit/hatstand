import type { HatstandApi } from '../../shared/api';
import { ideaSchema } from '../../shared/schemas';
import type { BacklogChat } from '../backlog-chat';
import { createBacklogPlanTask, readPlanReport, savePlan, setPlanApproval } from '../backlog-plan';
import type { ServiceContext } from './context';

export type BacklogService = Pick<HatstandApi, 'addIdeas' | 'planBacklog' | 'readBacklogPlan' | 'saveBacklogPlan' | 'setBacklogPlanApproval' | 'askBacklogChat' | 'cancelBacklogChat'>;

export type BacklogServiceDeps = {
  backlogChat: Pick<BacklogChat, 'ask' | 'cancel'>;
};

export function createBacklogService({ store, paths, emit }: ServiceContext, { backlogChat }: BacklogServiceDeps): BacklogService {
  return {
    addIdeas: async (companyId, ideas) => {
      // New ideas go to the end of the backlog, in the order given.
      const ranks = store.listTasks(companyId).flatMap((task) => (task.rank !== undefined ? [task.rank] : []));
      const firstRank = Math.max(-1, ...ranks) + 1;
      ideas
        .map((item) => ideaSchema.parse(item))
        .forEach((idea, index) => store.createTask({ companyId, title: idea.title, description: idea.description, checklist: idea.checklist, rank: firstRank + index }, undefined, 'idea'));
      emit('state-changed', null);
    },
    planBacklog: async (companyId, taskIds) => {
      const task = createBacklogPlanTask(store, companyId, taskIds);
      emit('state-changed', null);
      return task;
    },
    readBacklogPlan: async (taskId) => readPlanReport(store, paths, store.findTask(taskId)),
    saveBacklogPlan: async (taskId, plan) => {
      const report = savePlan(store, paths, taskId, plan);
      emit('state-changed', null);
      return report;
    },
    setBacklogPlanApproval: async (taskId, approved) => {
      const report = setPlanApproval(store, paths, taskId, approved);
      emit('state-changed', null);
      return report;
    },
    askBacklogChat: async (request) => backlogChat.ask(request),
    cancelBacklogChat: async (key) => backlogChat.cancel(key),
  };
}
