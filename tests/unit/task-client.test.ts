import { describe, expect, it } from 'vitest';
import { accountSchema, type TaskWorktree } from '../../src/shared/schemas';
import { accountInClient, clientChangeMessage, clientChangeOf } from '../../src/shared/task-client';

const copy: TaskWorktree = { projectId: 'api', path: '/copies/api', branch: 'hatstand/fix', base: 'main' };

describe('what changing the client of a task does', () => {
  it('moves a task with no session and no copy of the code', () => {
    expect(clientChangeOf({ id: 't', worktrees: [] }, [{ taskId: 'another' }])).toBe('move');
  });

  it('copies a task that has a session, even a stopped one', () => {
    expect(clientChangeOf({ id: 't', worktrees: [] }, [{ taskId: 't' }])).toBe('clone');
  });

  it('copies a task that has a copy of the code', () => {
    expect(clientChangeOf({ id: 't', worktrees: [copy] }, [])).toBe('clone');
  });

  it('says which of the two will happen, and where', () => {
    expect(clientChangeMessage('move', { name: 'Globex' })).toContain('Move to Globex?');
    expect(clientChangeMessage('clone', { name: 'Globex' })).toContain('Create a copy in Globex?');
  });
});

describe('the agent of a task in another client', () => {
  const accounts = [
    accountSchema.parse({ id: 'shared', name: 'Claude', type: 'claude-code', label: 'personal' }),
    accountSchema.parse({ id: 'acme-only', name: 'Acme agent', type: 'claude-code', label: 'company', companyId: 'acme' }),
  ];

  it('stays when every client can use it', () => {
    expect(accountInClient({ accountId: 'shared' }, accounts, 'globex')).toBe('shared');
  });

  it('is dropped when it belongs to the client the task leaves', () => {
    expect(accountInClient({ accountId: 'acme-only' }, accounts, 'globex')).toBeUndefined();
    expect(accountInClient({ accountId: 'acme-only' }, accounts, 'acme')).toBe('acme-only');
  });

  it('is nothing when the task has none', () => {
    expect(accountInClient({}, accounts, 'globex')).toBeUndefined();
  });
});
