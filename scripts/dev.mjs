// Runs Hatstand from source with its own data, so it never touches the installed app.
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [command = 'dev'] = process.argv.slice(2);
const env = { ...process.env, HATSTAND_HOME: process.env.HATSTAND_HOME ?? join(homedir(), '.hatstand-dev'), HATSTAND_DEV_COPY: '1' };
// Electron refuses to start as root on Linux without --no-sandbox, as in some containers.
if (process.platform === 'linux' && process.getuid?.() === 0) env.NO_SANDBOX ??= '1';
// electron-vite does not read Electron's own setting for an Electron placed by hand.
if (process.platform === 'linux' && process.env.ELECTRON_OVERRIDE_DIST_PATH && !process.env.ELECTRON_EXEC_PATH) env.ELECTRON_EXEC_PATH = join(process.env.ELECTRON_OVERRIDE_DIST_PATH, 'electron');
const { status } = spawnSync('pnpm', ['exec', 'electron-vite', command], { stdio: 'inherit', env });
process.exit(status ?? 1);
