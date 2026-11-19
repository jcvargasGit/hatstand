// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoDownload } from '../../src/renderer/src/components/RepoDownload';
import { RepoLinkDownload } from '../../src/renderer/src/components/RepoLinkDownload';
import type { BlockedFolder, Bridge, CloneProgress } from '../../src/shared/api';
import type { Company } from '../../src/shared/schemas';

const invoke = vi.fn();

const company: Company = {
  id: 'acme',
  name: 'Acme',
  color: '#E8A33D',
  origin: 'scratch',
  hasCode: true,
  confirmedSteps: [],
  skipPermissions: false,
  protectedPaths: [],
  links: [],
  subdomains: [],
  projects: [],
  context: {},
  gitSource: { provider: 'github', owner: 'acme' },
};

const repos = [
  { path: 'api', description: 'Uploads API', cloneUrl: 'https://github.com/acme/api.git', archived: false },
  { path: 'web', description: '', cloneUrl: 'https://github.com/acme/web.git', archived: false },
];

const blockedApi: CloneProgress = { path: 'api', state: 'failed', blocker: 'other-repository', error: '/code/api already holds a different repository.' };
const otherRepository: BlockedFolder = { target: '/code/api', blocker: 'other-repository', origin: 'git@github.com:someone-else/api.git', entries: 0, uncommitted: 2, unpushed: 1 };

/** Answers each method with a value, or with what a function returns, so a test can hold an answer back. */
const answer = (answers: Record<string, unknown>) =>
  invoke.mockImplementation(async (method: string, ...args: unknown[]) => {
    const found = answers[method];
    return typeof found === 'function' ? found(...args) : (found ?? []);
  });

const calls = (method: string) => invoke.mock.calls.filter(([name]) => name === method);

beforeEach(() => {
  invoke.mockReset();
  window.hatstand = { invoke, on: () => () => {} } as unknown as Bridge;
});

afterEach(cleanup);

describe('listing the repositories of a saved connection', () => {
  it('holds the place of the list while it asks, then shows the list', async () => {
    let finish = (_found: typeof repos) => {};
    answer({ listSecretNames: ['GITHUB_TOKEN'], connectGitSource: () => new Promise((resolve) => (finish = resolve)) });
    render(<RepoDownload company={company} />);

    const placeholder = screen.getByRole('status');
    expect(placeholder.getAttribute('aria-busy')).toBe('true');
    expect(within(placeholder).getByText('Listing repositories')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    await waitFor(() => expect(calls('connectGitSource')).toHaveLength(1));
    expect(screen.getByRole('status')).toBeTruthy();

    finish(repos);
    expect(await screen.findByRole('checkbox', { name: /api/ })).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the form when the client has no saved token', async () => {
    answer({ listSecretNames: [] });
    render(<RepoDownload company={company} />);
    expect(await screen.findByLabelText('Access token')).toBeTruthy();
    expect(screen.queryByText('Listing repositories')).toBeNull();
    expect(calls('connectGitSource')).toEqual([]);
  });

  it('shows the form at once for a client with no connection', () => {
    answer({ listSecretNames: () => new Promise(() => {}) });
    render(<RepoDownload company={{ ...company, gitSource: undefined }} />);
    expect(screen.getByRole('button', { name: 'Connect and list repositories' })).toBeTruthy();
    expect(screen.queryByText('Listing repositories')).toBeNull();
    expect(screen.getByRole('status', { name: 'Looking for a saved token' })).toBeTruthy();
  });
});

describe('a download that finds its folder taken', () => {
  const listed = async (downloads: CloneProgress[][]) => {
    const pending = [...downloads];
    answer({
      listSecretNames: ['GITHUB_TOKEN'],
      connectGitSource: repos,
      downloadRepos: () => pending.shift(),
      inspectBlockedFolder: otherRepository,
      trashBlockedFolder: undefined,
    });
    render(<RepoDownload company={company} />);
    await screen.findByRole('checkbox', { name: /api/ });
    await userEvent.click(screen.getByRole('button', { name: 'Download 2 repositories' }));
  };

  it('offers to replace only the folders that are taken', async () => {
    await listed([[blockedApi, { path: 'web', state: 'failed', error: 'Repository not found.' }]]);
    expect(await screen.findByText('/code/api already holds a different repository.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Replace folder' })).toHaveLength(1);
  });

  it('moves the folder to the trash only after its name is typed, then downloads again', async () => {
    await listed([[blockedApi, { path: 'web', state: 'cloned' }], [{ path: 'api', state: 'cloned' }]]);
    await userEvent.click(await screen.findByRole('button', { name: 'Replace folder' }));

    const warning = await screen.findByRole('alert');
    expect(await within(warning).findByText('/code/api holds another repository, from git@github.com:someone-else/api.git.')).toBeTruthy();
    expect(within(warning).getByText('Only on this computer: 2 files have changes that are not committed, and 1 commit is on no remote.')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('inspectBlockedFolder', 'acme', '~/projects/acme', 'api');

    const confirm = within(warning).getByRole('button', { name: 'Move to trash and download again' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await userEvent.type(within(warning).getByLabelText('Type api to confirm'), 'ap');
    expect(confirm.disabled).toBe(true);
    await userEvent.type(within(warning).getByLabelText('Type api to confirm'), 'i{Enter}');

    await waitFor(() => expect(calls('downloadRepos')).toHaveLength(2));
    expect(calls('trashBlockedFolder')).toEqual([['trashBlockedFolder', 'acme', '~/projects/acme', 'api', 'api']]);
    expect(calls('downloadRepos')[1]).toEqual(['downloadRepos', 'acme', '~/projects/acme', ['api']]);
    expect(invoke.mock.calls.findIndex(([name]) => name === 'trashBlockedFolder')).toBeLessThan(invoke.mock.calls.findLastIndex(([name]) => name === 'downloadRepos'));
    expect(await screen.findByText('Ready: api, in place of the folder that is now in the trash.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('leaves the folder alone when the person cancels', async () => {
    await listed([[blockedApi, { path: 'web', state: 'cloned' }]]);
    await userEvent.click(await screen.findByRole('button', { name: 'Replace folder' }));
    await userEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(calls('trashBlockedFolder')).toEqual([]);
    expect(screen.getByRole('button', { name: 'Replace folder' })).toBeTruthy();
  });

  it('keeps the warning open and says why when the trash fails', async () => {
    await listed([[blockedApi, { path: 'web', state: 'cloned' }]]);
    answer({
      inspectBlockedFolder: otherRepository,
      trashBlockedFolder: () => {
        throw new Error('Hatstand could not move /code/api to the trash, and nothing was deleted.');
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Replace folder' }));
    const warning = await screen.findByRole('alert');
    await userEvent.type(await within(warning).findByLabelText('Type api to confirm'), 'api{Enter}');
    expect(await within(warning).findByText('Hatstand could not move /code/api to the trash, and nothing was deleted.')).toBeTruthy();
    expect(calls('downloadRepos')).toHaveLength(1);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('says what a folder that is not a repository holds', async () => {
    await listed([[{ ...blockedApi, blocker: 'not-a-repository' }, { path: 'web', state: 'cloned' }]]);
    answer({ inspectBlockedFolder: { target: '/code/api', blocker: 'not-a-repository', entries: 3, uncommitted: 0, unpushed: 0 } });
    await userEvent.click(await screen.findByRole('button', { name: 'Replace folder' }));
    expect(await screen.findByText('/code/api is not a git repository. It holds 3 files and folders.')).toBeTruthy();
    expect(screen.queryByText(/Only on this computer/)).toBeNull();
  });

  it('works the same for a download from a link', async () => {
    const pending: CloneProgress[] = [blockedApi, { path: 'api', state: 'cloned' }];
    answer({ downloadRepoByLink: () => pending.shift(), inspectBlockedFolder: { ...otherRepository, uncommitted: 0, unpushed: 0 }, trashBlockedFolder: undefined });
    render(<RepoLinkDownload company={company} />);
    await userEvent.type(screen.getByLabelText('Repository link'), 'https://github.com/acme/api');
    await userEvent.click(screen.getByRole('button', { name: 'Download from link' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Replace folder' }));

    const warning = await screen.findByRole('alert');
    expect(await within(warning).findByText('Hatstand found no changes that are only on this computer.')).toBeTruthy();
    await userEvent.type(within(warning).getByLabelText('Type api to confirm'), 'api');
    await userEvent.click(within(warning).getByRole('button', { name: 'Move to trash and download again' }));

    expect(await screen.findByText('Downloaded api to ~/projects/acme.')).toBeTruthy();
    expect(calls('trashBlockedFolder')).toEqual([['trashBlockedFolder', 'acme', '~/projects/acme', 'api', 'api']]);
    expect(calls('downloadRepoByLink')).toHaveLength(2);
    expect(calls('downloadRepoByLink')[1]).toEqual(['downloadRepoByLink', 'acme', 'https://github.com/acme/api', '~/projects/acme']);
  });
});
