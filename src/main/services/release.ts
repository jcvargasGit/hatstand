import type { HatstandApi } from '../../shared/api';
import { isDevCopy } from '../dev-copy';
import { canInstallRelease, readReleaseStatus, startRelease } from '../release';
import type { ServiceContext } from './context';

export type ReleaseService = Pick<HatstandApi, 'getReleaseStatus' | 'startRelease'>;

/** What the running app knows about itself. The composition root reads it from Electron; a test passes plain values. */
export type InstalledApp = {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  /** The folder the app runs from. */
  appRoot: string;
};

/** Installing the version being developed over the app the person works in. Only the development copy offers it. */
export function createReleaseService({ paths, tools }: Pick<ServiceContext, 'paths' | 'tools'>, { installedApp }: { installedApp: InstalledApp }): ReleaseService {
  const canRelease = () => canInstallRelease({ platform: installedApp.platform, isDevCopy: isDevCopy(), isPackaged: installedApp.isPackaged });
  const folders = () => ({ home: paths.home, appRoot: installedApp.appRoot, path: tools.path });
  return {
    getReleaseStatus: async () => (canRelease() ? readReleaseStatus(folders()) : null),
    startRelease: async () => {
      if (canRelease()) startRelease(folders(), tools.nodePath);
    },
  };
}
