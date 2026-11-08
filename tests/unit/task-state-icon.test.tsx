// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskStateIcon } from '../../src/renderer/src/components/TaskStateIcon';
import { companySchema, taskSchema, type Session } from '../../src/shared/schemas';

const company = companySchema.parse({ id: 'c', name: 'Client', color: '#5BB8A6' });
const task = (change: Record<string, unknown> = {}) => taskSchema.parse({ id: 't', companyId: 'c', title: 'Fix it', status: 'doing', createdAt: 'x', updatedAt: 'x', ...change });
const session = (state: Session['state']): Session => ({ id: 's', taskId: 't', companyId: 'c', accountId: 'a', cwd: '/x', state, startedAt: 'x', updatedAt: 'x' });

afterEach(cleanup);

describe('the icon of a task', () => {
  it.each([
    ['working', 'Working', /is processing/],
    ['background', 'Running in the background', /left work running/],
    ['needs-input', 'Needs your answer', /until you answer/],
    ['idle', 'Your turn', /next message/],
    ['stopped', 'Paused', /Resume the session/],
  ] as const)('explains %s when you hover over it', (state, label, meaning) => {
    render(<TaskStateIcon item={{ task: task(), company, session: session(state) }} />);
    expect(screen.getByRole('img', { name: label }).getAttribute('title')).toMatch(meaning);
  });

  it('shows what a task is without a session, and when finished, over any session', () => {
    render(<TaskStateIcon item={{ task: task({ status: 'todo' }), company, session: undefined }} />);
    expect(screen.getByRole('img', { name: 'Not started' })).toBeTruthy();
    cleanup();
    render(<TaskStateIcon item={{ task: task({ status: 'done' }), company, session: session('working') }} />);
    expect(screen.getByRole('img', { name: 'Done' })).toBeTruthy();
  });
});
