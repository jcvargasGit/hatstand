import { execFile } from 'node:child_process';

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

/** One run of an agent that answers and exits. `input` is what it reads from standard input. */
export type AgentLaunch = { args: string[]; env: Record<string, string>; input?: string };
export type RunResult = { stdout: string; failure?: 'timeout' | 'cancelled' | 'failed'; detail?: string };
export type AgentRunner = (executable: string, launch: AgentLaunch, cwd: string, signal: AbortSignal) => Promise<RunResult>;

export const execFileRunner =
  (timeoutMs: number): AgentRunner =>
  (executable, launch, cwd, signal) =>
    new Promise((resolve) => {
      const child = execFile(executable, launch.args, { cwd, env: launch.env, signal, timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES }, (error, stdout, stderr) => {
        if (!error) return resolve({ stdout });
        if (signal.aborted) return resolve({ stdout, failure: 'cancelled' });
        if ('killed' in error && error.killed) return resolve({ stdout, failure: 'timeout' });
        resolve({ stdout, failure: 'failed', detail: stderr.trim() || error.message });
      });
      if (launch.input === undefined) return;
      // An agent that stops before reading everything closes the pipe; the callback above reports why it stopped.
      child.stdin?.on('error', () => {});
      child.stdin?.end(launch.input);
    });
