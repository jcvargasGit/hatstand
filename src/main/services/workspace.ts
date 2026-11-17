import type { HatstandApi } from '../../shared/api';
import { listClientFiles } from '../client-files';
import { detectEditor } from '../editor';
import type { ReviewMonitor } from '../review-monitor';
import { searchWorkspace } from '../search';
import type { ServiceContext } from './context';

/** Reads across every client: what the interface draws, and what the search finds. */
export type WorkspaceService = Pick<HatstandApi, 'getSnapshot' | 'searchEverything' | 'detectEditor'>;

export function createWorkspaceService({ store, paths, tools }: ServiceContext, { reviews }: { reviews: Pick<ReviewMonitor, 'all'> }): WorkspaceService {
  return {
    detectEditor: async () => detectEditor(tools.path)?.name ?? null,
    getSnapshot: async () => ({ ...store.snapshot(), reviews: reviews.all() }),
    searchEverything: async (query) => {
      const companies = store.listCompanies();
      return searchWorkspace(query, {
        companies,
        tasks: companies.flatMap((company) => store.listTasks(company.id)),
        readNotes: (task) => store.readNotes(task),
        listFiles: (company) => listClientFiles(paths, company),
      });
    },
  };
}
