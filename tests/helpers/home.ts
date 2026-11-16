// A throwaway Hatstand folder for a test, so no test ever touches ~/.hatstand.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dataPaths, type DataPaths } from '../../src/main/paths';
import { Store } from '../../src/main/store';

export type TestHome = {
  /** The throwaway folder. The Hatstand folder is `data` inside it, so a test can add folders next to it. */
  root: string;
  paths: DataPaths;
  store: Store;
  /** A folder next to the Hatstand folder, created if it is missing. */
  folder: (...parts: string[]) => string;
  remove: () => void;
};

export function makeHome(prefix = 'hatstand-test-'): TestHome {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  const paths = dataPaths(join(root, 'data'));
  return {
    root,
    paths,
    store: new Store(paths),
    folder: (...parts) => {
      const path = join(root, ...parts);
      mkdirSync(path, { recursive: true });
      return path;
    },
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}

export function makeGitRepo(path: string): string {
  mkdirSync(path, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: path });
  return path;
}
