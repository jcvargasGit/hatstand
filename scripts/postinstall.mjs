// Finishes what the packages leave undone. Each step only warns when it fails, so that
// tests and builds still work on a machine without internet or without a compiler.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const FIVE_MINUTES_MS = 300_000;

function warn(what, consequence) {
  console.warn(`hatstand: ${what}. ${consequence}`);
}

function run(args, cwd) {
  const { status } = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', timeout: FIVE_MINUTES_MS });
  return status === 0;
}

function prepareTerminals() {
  const packageRoot = dirname(require.resolve('node-pty/package.json'));
  const prebuilds = join(packageRoot, 'prebuilds', `${process.platform}-${process.arch}`);

  if (existsSync(prebuilds)) {
    // node-pty publishes its macOS spawn-helper without the execute bit, and every terminal fails without it.
    const helper = join(prebuilds, 'spawn-helper');
    if (existsSync(helper)) chmodSync(helper, 0o755);
    return;
  }

  // Linux has no prebuilt binary. Node's own headers let the build run without downloading them.
  const nodeDir = dirname(dirname(process.execPath));
  const headers = existsSync(join(nodeDir, 'include', 'node')) ? [`--nodedir=${nodeDir}`] : [];
  const built = run([require.resolve('node-gyp/bin/node-gyp.js'), 'rebuild', ...headers], packageRoot);
  if (!built) warn('node-pty could not be built', 'Agent terminals will not open until it is. Tests and builds still work.');
}

function downloadElectron() {
  const installed = run([join(dirname(require.resolve('electron/package.json')), 'install.js')]);
  if (!installed) warn('Electron could not be downloaded', 'The app will not open until `node node_modules/electron/install.js` succeeds. Tests and builds still work.');
}

prepareTerminals();
downloadElectron();
