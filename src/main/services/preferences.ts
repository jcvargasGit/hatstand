import type { HatstandApi } from '../../shared/api';
import { stayAwakeModeSchema, todayLayoutSchema } from '../../shared/schemas';
import type { StayAwake } from '../stay-awake';
import type { ServiceContext } from './context';

export type PreferenceService = Pick<HatstandApi, 'getStayAwake' | 'setStayAwake' | 'setClientOrder' | 'setTodayLayout' | 'setGuideNewTasks' | 'setAutoSendPrompt'>;

export type PreferenceServiceDeps = {
  stayAwake: Pick<StayAwake, 'active'>;
  /** Keeps the computer awake or lets it sleep, following the saved mode and the running sessions. */
  applyStayAwake: () => void;
};

export function createPreferenceService({ store, emit }: Pick<ServiceContext, 'store' | 'emit'>, { stayAwake, applyStayAwake }: PreferenceServiceDeps): PreferenceService {
  return {
    getStayAwake: async () => ({ mode: store.readPreferences().stayAwake, active: stayAwake.active }),
    setStayAwake: async (mode) => {
      store.savePreferences({ stayAwake: stayAwakeModeSchema.parse(mode) });
      applyStayAwake();
      emit('state-changed', null);
    },
    setClientOrder: async (companyIds) => {
      store.savePreferences({ clientOrder: companyIds });
      emit('state-changed', null);
    },
    setTodayLayout: async (layout) => {
      store.savePreferences({ todayLayout: todayLayoutSchema.parse(layout) });
      emit('state-changed', null);
    },
    setGuideNewTasks: async (enabled) => {
      store.savePreferences({ guideNewTasks: enabled === true });
      emit('state-changed', null);
    },
    setAutoSendPrompt: async (enabled) => {
      store.savePreferences({ autoSendPrompt: enabled === true });
      emit('state-changed', null);
    },
  };
}
