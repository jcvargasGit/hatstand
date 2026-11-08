// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bridge, ReleaseStatus } from '../../src/shared/api';
import { ReleaseControl } from '../../src/renderer/src/components/ReleaseControl';

const status = (change: Partial<ReleaseStatus> = {}): ReleaseStatus => ({ state: 'idle', installedVersion: 'aaaaaaa', mainVersion: 'bbbbbbb', commitsOutsideMain: 0, ...change });

function open(current: ReleaseStatus | null) {
  const invoke = vi.fn(async (method: string) => (method === 'getReleaseStatus' ? current : undefined));
  window.hatstand = { invoke, on: () => () => {} } as unknown as Bridge;
  render(<ReleaseControl />);
  return invoke;
}

const button = () => screen.findByRole('button', { name: 'Update installed app' });

afterEach(cleanup);

describe('updating the installed app from development', () => {
  it('does not exist outside development', async () => {
    const invoke = open(null);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('getReleaseStatus'));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('starts an update when main has something new, and shows it is building', async () => {
    const invoke = open(status());
    await userEvent.click(await button());
    expect(invoke).toHaveBeenCalledWith('startRelease');
    expect(await screen.findByText(/Building version bbbbbbb/)).toBeTruthy();
    expect(((await button()) as HTMLButtonElement).disabled).toBe(true);
  });

  it('explains why there is nothing to update', async () => {
    open(status({ installedVersion: 'bbbbbbb' }));
    expect(((await button()) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toMatch(/up to date/);
  });

  it('says it waits for you to close the app, and lets you build something newer', async () => {
    open(status({ state: 'waiting', version: 'bbbbbbb' }));
    expect(((await button()) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toMatch(/installs when you close Hatstand/);
    cleanup();
    open(status({ state: 'waiting', version: 'ccccccc' }));
    expect(((await button()) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows why it failed and lets you try again', async () => {
    open(status({ state: 'failed', version: 'bbbbbbb', installedVersion: 'bbbbbbb', message: 'Close it first.' }));
    expect(((await button()) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('status').textContent).toBe('Close it first.');
  });

  it('warns about work that is not in main', async () => {
    open(status({ commitsOutsideMain: 2 }));
    expect(await screen.findByText(/2 commits here are not in main/)).toBeTruthy();
  });
});
