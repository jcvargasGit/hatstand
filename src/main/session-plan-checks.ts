// The agent planning a backlog checks its plan through hatstand-check-plan, which leaves a .request file
// and waits for a .ok or .error reply.
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Session } from '../shared/schemas';
import { answerPlanCheck } from './backlog-plan';
import { CHECK_PLAN_TOOL, PLAN_CHECKS_ENV } from './check-plan-tool';
import type { DataPaths } from './paths';
import { writePrivateFile, type Store } from './store';

/** Prepares a session that plans a backlog to check its plan: the folder for its requests, and hatstand-check-plan on the PATH. */
export function preparePlanChecks(paths: DataPaths, sessionId: string): { folder: string; env: Record<string, string> } {
  const folder = paths.planChecksDir(sessionId);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  writePrivateFile(paths.checkPlanTool, CHECK_PLAN_TOOL);
  chmodSync(paths.checkPlanTool, 0o700);
  return { folder, env: { [PLAN_CHECKS_ENV]: folder } };
}

/** Answers every plan check the agent of the session left in the folder. */
export function answerPlanChecks(store: Store, paths: DataPaths, session: Pick<Session, 'taskId'>, folder: string): void {
  if (!existsSync(folder)) return;
  for (const request of readdirSync(folder).filter((name) => name.endsWith('.request'))) {
    const file = join(folder, request);
    const reply = file.slice(0, -'.request'.length);
    rmSync(file);
    try {
      const { ok, text } = answerPlanCheck(store, paths, session.taskId);
      writePrivateFile(`${reply}.${ok ? 'ok' : 'error'}`, text);
    } catch (error) {
      writePrivateFile(`${reply}.error`, `${error instanceof Error ? error.message : 'The plan could not be checked.'}\n`);
    }
  }
}
