import { accountsForClient } from './accounts';
import type { Account, Company, Session, Task } from './schemas';

/** What changing the client of a task does: it moves the task, or leaves it and creates a copy. */
export type ClientChange = 'move' | 'clone';

/**
 * A task that was never started moves. A task with a session or a copy of the code stays,
 * because its conversations and its branches belong to the client it was started in.
 */
export function clientChangeOf(task: Pick<Task, 'id' | 'worktrees'>, sessions: Pick<Session, 'taskId'>[]): ClientChange {
  const started = task.worktrees.length > 0 || sessions.some((session) => session.taskId === task.id);
  return started ? 'clone' : 'move';
}

/** The agent account of a task, when the other client can use it too. */
export function accountInClient(task: Pick<Task, 'accountId'>, accounts: Account[], companyId: string): string | undefined {
  return accountsForClient(accounts, companyId).find((account) => account.id === task.accountId)?.id;
}

/** What the person is told before the client of a task changes. */
export function clientChangeMessage(change: ClientChange, destination: Pick<Company, 'name'>): string {
  return change === 'move'
    ? `Move to ${destination.name}? It gets a new number there, the default area and no repositories.`
    : `This task was already started, so it cannot be moved. Create a copy in ${destination.name}? Its sessions, code and notes stay here.`;
}
