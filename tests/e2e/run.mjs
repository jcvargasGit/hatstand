// Runs the end-to-end suites in order and stops at the first one that fails.
// Name suites to run only those: node tests/e2e/run.mjs smoke clients
// On Linux without a screen, such as a container, each suite runs on a virtual screen (xvfb-run).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SUITES = ['smoke', 'onboarding', 'workspaces', 'productivity', 'review', 'clients'];
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const wanted = process.argv.slice(2);
const unknown = wanted.filter((name) => !SUITES.includes(name));
if (unknown.length > 0) {
  console.error(`Unknown suite: ${unknown.join(', ')}. The suites are: ${SUITES.join(', ')}.`);
  process.exit(2);
}

const electron = require('electron');
if (!existsSync(electron)) {
  console.error(`Electron is not installed, so the app cannot open. Run node node_modules/electron/install.js, or put Electron ${require('electron/package.json').version} in ${dirname(electron)}.`);
  process.exit(1);
}

const onVirtualScreen = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
if (onVirtualScreen && spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' }).error) {
  console.error('There is no screen, and xvfb-run is not installed. Install xvfb, or run the tests where there is a screen.');
  process.exit(1);
}

for (const suite of wanted.length > 0 ? wanted : SUITES) {
  const file = join(here, `${suite}.mjs`);
  const [command, ...args] = onVirtualScreen ? ['xvfb-run', '-a', process.execPath, file] : [process.execPath, file];
  console.log(`\n▶ ${suite}`);
  const { status, signal } = spawnSync(command, args, { stdio: 'inherit' });
  if (status !== 0) {
    console.error(`\n✖ ${suite} failed${signal ? ` (${signal})` : ''}.`);
    process.exit(status || 1);
  }
}
console.log('\n✔ All end-to-end suites passed.');
