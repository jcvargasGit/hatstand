// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupWizard } from '../../src/renderer/src/components/SetupWizard';
import type { Bridge, Snapshot } from '../../src/shared/api';
import type { Company } from '../../src/shared/schemas';

const invoke = vi.fn();

const empty: Company = {
  id: 'acme',
  name: 'Acme',
  color: '#E8A33D',
  origin: 'existing',
  hasCode: true, confirmedSteps: [],
  skipPermissions: false,
  protectedPaths: [], links: [],
  subdomains: [],
  projects: [],
  context: {},
};

const snapshotOf = (company: Company): Snapshot => ({
  companies: [company],
  accounts: { defaultAccountId: 'c', accounts: [{ id: 'c', name: 'Claude', type: 'claude-code', label: 'personal' }] },
  tasks: [],
  sessions: [],
  reviews: {},
  todayLayout: 'list',
  guideNewTasks: true,
  localKnowledge: [],
  localPlugin: [],
  starterInstructions: [],
  clientFolders: { acme: { knowledge: '/home/acme/knowledge', llmConfig: '/home/acme/plugin', planning: '/home/acme/planning', defaultRoot: '/code' } },
});

const answer = (overrides: Record<string, unknown> = {}) =>
  invoke.mockImplementation(async (method: string) => {
    if (method in overrides) return overrides[method];
    return method === 'checkAgent' ? { installed: true, signedIn: true, email: 'me@test.dev' } : [];
  });

const renderWizard = async (company: Company = empty, handlers: { onFinish?: () => void } = {}) => {
  render(
    <SetupWizard
      snapshot={snapshotOf(company)}
      company={company}
      onChanged={vi.fn(async () => {})}
      onFinish={handlers.onFinish ?? vi.fn()}
      onOpenArea={vi.fn()}
      onOpenTask={vi.fn(async () => {})}
    />,
  );
  await screen.findByRole('navigation', { name: 'Setup steps' });
};

beforeEach(() => {
  invoke.mockReset();
  answer();
  window.hatstand = { invoke, on: () => () => {} } as unknown as Bridge;
});

afterEach(cleanup);

describe('a client without code', () => {
  const stepNames = () => screen.getAllByRole('button').map((button) => button.textContent ?? '');

  it('hides the steps about code, and starts in Areas', async () => {
    await renderWizard({ ...empty, hasCode: false });
    expect(screen.getByRole('heading', { name: 'Areas of this client' })).toBeTruthy();
    const names = stepNames();
    for (const hidden of ['Repositories', 'Commit identity', 'Protection']) expect(names.some((name) => name.includes(hidden))).toBe(false);
    expect(names.some((name) => name.includes('Knowledge'))).toBe(true);
    expect(names.some((name) => name.includes('Planning'))).toBe(true);
  });

  it('saves the choice from the Name step', async () => {
    answer({ saveCompany: undefined });
    await renderWizard();
    await userEvent.click(screen.getByRole('button', { name: /Name/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /This client has code/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('saveCompany', expect.objectContaining({ hasCode: false })));
  });

  it('keeps the choice locked while the client has repositories', async () => {
    await renderWizard({ ...empty, projects: [{ id: 'api', name: 'api', path: '/code/api' }] });
    await userEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect((screen.getByRole('checkbox', { name: /This client has code/ }) as HTMLInputElement).disabled).toBe(true);
  });
});

describe('SetupWizard', () => {
  it('opens on the first step still missing, and explains it', async () => {
    await renderWizard();
    expect(screen.getByRole('heading', { name: 'Where is the code?' })).toBeTruthy();
    expect(screen.getByText(/Connect the company/)).toBeTruthy();
  });

  it('starts a client from scratch on the agent, then offers to download repositories', async () => {
    await renderWizard({ ...empty, origin: 'scratch' });
    expect(screen.getByRole('heading', { name: 'Which agent?' })).toBeTruthy();
    expect(await screen.findByText(/Signed in as me@test.dev/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('button', { name: 'Connect and list repositories' })).toBeTruthy();
  });

  it('moves forward and back, and offers to skip a step that is not done', async () => {
    await renderWizard();
    await userEvent.click(screen.getByRole('button', { name: /Keys and tools/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(screen.getByRole('heading', { name: 'Links of this client' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Keys and tools' })).toBeTruthy();
  });

  it('continuing without repositories uses the default folder', async () => {
    await renderWizard();
    expect(screen.getByText('Continue uses the default folder: /code')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('resetClientFolder', 'acme'));
    expect(await screen.findByRole('heading', { name: 'Areas of this client' })).toBeTruthy();
  });

  it('continuing in Knowledge accepts the folder Hatstand created', async () => {
    await renderWizard();
    await userEvent.click(screen.getByRole('button', { name: /Knowledge/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('saveCompany', expect.objectContaining({ confirmedSteps: ['knowledge'] })));
  });

  it('shows the folders Hatstand created for the client', async () => {
    await renderWizard();
    await userEvent.click(screen.getByRole('button', { name: /LLM config/ }));
    expect(screen.getByText('/home/acme/plugin')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Open folder' }));
    expect(invoke).toHaveBeenCalledWith('openClientFolder', 'acme', 'llm-config');
  });

  it('asks to sign in when the agent is not signed in, and says how to install it when missing', async () => {
    answer({ checkAgent: { installed: true, signedIn: false }, startAgentSignIn: 'terminal' });
    await renderWizard({ ...empty, origin: 'scratch' });
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
    cleanup();
    answer({ checkAgent: { installed: false, signedIn: false } });
    await renderWizard({ ...empty, origin: 'scratch' });
    expect(await screen.findByText(/not installed on this computer/)).toBeTruthy();
  });

  it('saves a change made in a step', async () => {
    await renderWizard();
    await userEvent.click(screen.getByRole('button', { name: /Agent/ }));
    await userEvent.click(screen.getByRole('checkbox'));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('saveCompany', expect.objectContaining({ skipPermissions: true })),
    );
  });

  it('jumps from the review to the step that fixes an item', async () => {
    const onFinish = vi.fn();
    await renderWizard(empty, { onFinish });
    await userEvent.click(screen.getByRole('button', { name: /Review/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add knowledge' }));
    expect(screen.getByRole('heading', { name: 'Client knowledge' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /Review/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Go to tasks' }));
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it('keeps the settings that used to live on their own page', async () => {
    await renderWizard();
    expect(screen.getByRole('heading', { name: 'Client folder' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /LLM config/ }));
    expect(screen.getByText('MCP servers')).toBeTruthy();
    expect(screen.getByText('Instructions')).toBeTruthy();
  });

  it('opens on the review when everything counted is done, once keys have loaded', async () => {
    const ready: Company = {
      ...empty,
      projects: [{ id: 'a', name: 'a', path: '/a' }],
      protectedPaths: ['/a'],
      gitIdentity: { name: 'A', email: 'a@e.dev', folder: '/repos/', appliedAt: 'x' },
      context: { knowledgeDir: '/kb', pluginDir: '/plugin' },
    };
    answer({ listSecretNames: ['GITHUB_TOKEN'] });
    await renderWizard(ready);
    expect(screen.getByRole('heading', { name: 'Review' })).toBeTruthy();
  });
});

describe('protection list', () => {
  const repo = (name: string, state: string, reason?: string) => ({ name, path: `/code/${name}`, state, reason });

  it('lists what is not protected, and can keep an existing hook', async () => {
    answer({
      guardStatus: [repo('api', 'protected'), repo('web', 'existing-hook', 'This repository already has a pre-commit hook.'), repo('ops', 'managed-elsewhere', 'Managed elsewhere.')],
      installGuard: { installed: ['/code/api', '/code/web'], skipped: [], secrets: 1, knowledgeLines: 2 },
    });
    await renderWizard();
    await userEvent.click(screen.getByRole('button', { name: /Protection/ }));

    expect(await screen.findByText('1 of 3 repositories protected.')).toBeTruthy();
    expect(screen.getByText(/already has a pre-commit hook/)).toBeTruthy();
    expect(screen.getByText('Managed elsewhere.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Protect and keep its hook' })).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Protect and keep its hook' }));
    expect(invoke).toHaveBeenCalledWith('installGuard', 'acme', ['/code/web']);
  });
});

describe('suggesting subdomains from names', () => {
  it('shows the proposal first and saves only what stays selected', async () => {
    const company: Company = {
      ...empty,
      subdomains: [{ id: 'uploads', name: 'Uploads', description: '', folders: [], links: [] }],
      projects: [
        { id: '1', name: 'core-uploads-api', path: '/1' },
        { id: '2', name: 'app-rain-maps', path: '/2' },
        { id: '3', name: 'app-rain-alerts', path: '/3' },
      ],
    };
    await renderWizard(company);
    await userEvent.click(screen.getByRole('button', { name: /Areas/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Suggest from repository names' }));
    expect(invoke).not.toHaveBeenCalledWith('saveCompany', expect.anything());

    await userEvent.click(screen.getByRole('checkbox', { name: 'Use Rain' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply 1 area' }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'saveCompany',
        expect.objectContaining({
          subdomains: [{ id: 'uploads', name: 'Uploads', description: '', folders: [], links: [] }],
          projects: [
            { id: '1', name: 'core-uploads-api', path: '/1', subdomainId: 'uploads' },
            { id: '2', name: 'app-rain-maps', path: '/2' },
            { id: '3', name: 'app-rain-alerts', path: '/3' },
          ],
        }),
      ),
    );
  });
});

describe('downloading repositories', () => {
  const repos = [
    { path: 'api', description: 'Uploads API', cloneUrl: 'https://github.com/acme/api.git', archived: false },
    { path: 'web', description: '', cloneUrl: 'https://github.com/acme/web.git', archived: false },
    { path: 'old', description: '', cloneUrl: 'https://github.com/acme/old.git', archived: true },
  ];

  it('connects, hides archived repositories, and downloads what is selected', async () => {
    answer({ connectGitSource: repos, downloadRepos: [{ path: 'api', state: 'cloned' }] });
    await renderWizard({ ...empty, origin: 'scratch' });
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect((screen.getByRole('button', { name: 'Connect and list repositories' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('Organization or user'), 'acme');
    await userEvent.type(screen.getByLabelText('Access token'), 'token-value');
    await userEvent.click(screen.getByRole('button', { name: 'Connect and list repositories' }));
    expect(invoke).toHaveBeenCalledWith('connectGitSource', 'acme', expect.objectContaining({ provider: 'github', owner: 'acme' }), 'token-value');

    await screen.findByText('api');
    expect(screen.queryByText('old')).toBeNull();
    await userEvent.click(screen.getByRole('checkbox', { name: /web/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Download 1 repository' }));
    expect(invoke).toHaveBeenCalledWith('downloadRepos', 'acme', '~/projects/acme', ['api']);
    expect(await screen.findByText(/Ready: 1 repository/)).toBeTruthy();
  });

  it('shows why a connection failed', async () => {
    invoke.mockImplementation(async (method: string) => {
      if (method === 'connectGitSource') throw new Error('GitHub rejected this token.');
      return method === 'checkAgent' ? { installed: true, signedIn: true } : [];
    });
    await renderWizard({ ...empty, origin: 'scratch' });
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.type(screen.getByLabelText('Organization or user'), 'acme');
    await userEvent.click(screen.getByRole('button', { name: 'Connect and list repositories' }));
    expect(await screen.findByText(/rejected this token/)).toBeTruthy();
  });
});
