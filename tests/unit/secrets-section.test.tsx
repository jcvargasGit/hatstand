// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SecretsSection } from '../../src/renderer/src/components/SecretsSection';
import type { Bridge } from '../../src/shared/api';
import type { GitSource, KeyInfo } from '../../src/shared/schemas';

const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(Date.now() + days * DAY + DAY / 2).toISOString();
const checked = (rest: object = {}) => ({ at: new Date().toISOString(), result: 'valid' as const, ...rest });

const invoke = vi.fn();
let keys: KeyInfo[];
let failing: Record<string, string>;

/** A main process that keeps the names it was given and forgets the values, as the real one answers. */
const answerLikeTheApp = () =>
  invoke.mockImplementation(async (method: string, _companyId: string, name: string, extra: string) => {
    if (failing[method]) throw new Error(failing[method]);
    if (method === 'listKeys') return keys;
    if (method === 'setSecret') keys = [...keys.filter((key) => key.name !== name), { name, savedAt: new Date().toISOString() }];
    if (method === 'deleteSecret') keys = keys.filter((key) => key.name !== name);
    if (method === 'checkKey') keys = keys.map((key) => (key.name === name ? { ...key, check: checked({ expiresAt: inDays(100) }) } : key));
    if (method === 'setKeyNote') keys = keys.map((key) => (key.name === name ? { ...key, note: extra } : key));
    if (method === 'importEnvFile') return 2;
    return undefined;
  });

const show = async (saved: KeyInfo[] = [], gitSource?: GitSource) => {
  keys = saved;
  render(<SecretsSection companyId="acme" gitSource={gitSource} />);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('listKeys', 'acme'));
  if (saved[0]) await screen.findByRole('button', { name: `Delete key ${saved[0].name}` });
};

const rowOf = (name: string) => {
  const row = screen.getByText(name, { selector: 'code' }).closest('li');
  if (!row) throw new Error(`No row for ${name}`);
  return within(row);
};

beforeEach(() => {
  invoke.mockReset();
  failing = {};
  answerLikeTheApp();
  window.hatstand = { invoke, on: () => () => {} } as unknown as Bridge;
});

afterEach(cleanup);

describe('what each key is for', () => {
  it('shows the keys of Jira, GitHub and GitLab with their purpose, also before they are added', async () => {
    await show();
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Jira', 'GitHub', 'GitLab', 'Other keys']);
    expect(rowOf('GITHUB_TOKEN').getByText(/lists and downloads repositories, signs git in during sessions, and reads pull requests/)).toBeTruthy();
    expect(rowOf('JIRA_API_TOKEN').getByText(/works only with JIRA_SITE and JIRA_EMAIL/)).toBeTruthy();
    expect(rowOf('GITLAB_URL').getByText(/uses gitlab.com without it/)).toBeTruthy();
    expect(rowOf('JIRA_SITE').getByText('Not added')).toBeTruthy();
    expect(screen.queryByText('GH_TOKEN')).toBeNull();
  });

  it('shows GH_TOKEN only when the client has it', async () => {
    await show([{ name: 'GH_TOKEN' }]);
    expect(rowOf('GH_TOKEN').getByText(/Used like GITHUB_TOKEN/)).toBeTruthy();
  });

  it('says a key Hatstand does not know reaches the agents, under Other keys', async () => {
    await show([{ name: 'ACME_API_TOKEN', savedAt: '2026-11-03T12:00:00Z' }]);
    const row = rowOf('ACME_API_TOKEN');
    expect(row.getByText(/environment variable in this client/)).toBeTruthy();
    expect(row.getByText('Saved on Nov 3, 2026.')).toBeTruthy();
    expect(row.queryByRole('button', { name: 'Check ACME_API_TOKEN' })).toBeNull();
    expect(row.queryByRole('link')).toBeNull();
  });

  it('links to where a new token is created, on the GitLab of the client, with what it needs', async () => {
    await show([], { provider: 'gitlab', owner: 'acme', host: 'git.acme.dev' });
    const gitlab = rowOf('GITLAB_TOKEN');
    expect(gitlab.getByRole('link', { name: /Get a new token/ }).getAttribute('href')).toContain('https://git.acme.dev/-/user_settings/personal_access_tokens');
    expect(gitlab.getByText(/read_api and write_repository/)).toBeTruthy();
    expect(rowOf('GITHUB_TOKEN').getByRole('link', { name: /Get a new token/ }).getAttribute('href')).toContain('https://github.com/settings/tokens');
    expect(rowOf('JIRA_API_TOKEN').getByRole('link', { name: /Get a new token/ }).getAttribute('href')).toContain('id.atlassian.com');
    expect(rowOf('JIRA_SITE').queryByRole('link')).toBeNull();
  });
});

describe('the state of a key', () => {
  it('tells a valid, an expiring, an expired and a rejected key apart', async () => {
    await show([
      { name: 'GITHUB_TOKEN', check: checked({ expiresAt: inDays(100) }) },
      { name: 'GITLAB_TOKEN', check: checked({ expiresAt: inDays(5) }) },
      { name: 'GH_TOKEN', check: checked({ expiresAt: inDays(-3) }) },
      { name: 'JIRA_API_TOKEN', check: checked({ result: 'rejected' }) },
      { name: 'JIRA_SITE' },
      { name: 'JIRA_EMAIL' },
    ]);
    expect(rowOf('GITHUB_TOKEN').getByText(/^Valid until /).className).toContain('is-valid');
    expect(rowOf('GITLAB_TOKEN').getByText('Expires in 5 days').className).toContain('is-expires-soon');
    expect(rowOf('GITLAB_TOKEN').getByText(/before it stops working/)).toBeTruthy();
    expect(rowOf('GH_TOKEN').getByText(/^Expired on /).className).toContain('is-expired');
    expect(rowOf('JIRA_API_TOKEN').getByText('Rejected').className).toContain('is-rejected');
    expect(rowOf('JIRA_API_TOKEN').getByText(/Jira rejected it. Check JIRA_SITE and JIRA_EMAIL/)).toBeTruthy();
    expect(rowOf('GITHUB_TOKEN').queryByText(/replace this one/)).toBeNull();
  });

  it('says a token was not checked yet, and says nothing for a key it cannot check', async () => {
    await show([{ name: 'GITHUB_TOKEN' }, { name: 'JIRA_SITE' }]);
    expect(rowOf('GITHUB_TOKEN').getByText('Not checked')).toBeTruthy();
    expect(rowOf('JIRA_SITE').queryByText('Not checked')).toBeNull();
  });

  it('asks the provider on Check, and shows the expiry it reports', async () => {
    await show([{ name: 'GITHUB_TOKEN' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Check GITHUB_TOKEN' }));
    expect(invoke).toHaveBeenCalledWith('checkKey', 'acme', 'GITHUB_TOKEN');
    expect(await rowOf('GITHUB_TOKEN').findByText(/^Valid until /)).toBeTruthy();
  });

  it('shows why a check failed on the row of that key', async () => {
    await show([{ name: 'GITHUB_TOKEN' }]);
    failing.checkKey = 'GitHub answered 503, so Hatstand could not check this key.';
    await userEvent.click(screen.getByRole('button', { name: 'Check GITHUB_TOKEN' }));
    expect(await rowOf('GITHUB_TOKEN').findByText(/GitHub answered 503/)).toBeTruthy();
  });

  it('offers no check for the Jira token until the site and the email are there', async () => {
    await show([{ name: 'JIRA_API_TOKEN' }]);
    expect(screen.queryByRole('button', { name: 'Check JIRA_API_TOKEN' })).toBeNull();
  });
});

describe('replacing a key', () => {
  it('replaces it from its row, without typing the name or deleting it first', async () => {
    await show([{ name: 'GITHUB_TOKEN', check: checked({ result: 'rejected' }) }]);
    await userEvent.click(screen.getByRole('button', { name: 'Replace GITHUB_TOKEN' }));
    const field = screen.getByLabelText('New value for GITHUB_TOKEN');
    expect(field.getAttribute('type')).toBe('password');
    await userEvent.type(field, 'ghp_new-secret-value');
    await userEvent.click(rowOf('GITHUB_TOKEN').getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('setSecret', 'acme', 'GITHUB_TOKEN', 'ghp_new-secret-value'));
    expect(invoke).not.toHaveBeenCalledWith('deleteSecret', 'acme', 'GITHUB_TOKEN');
    await waitFor(() => expect(screen.queryByLabelText('New value for GITHUB_TOKEN')).toBeNull());
    expect(document.body.textContent).not.toContain('ghp_new-secret-value');
    expect(document.querySelector('input[value="ghp_new-secret-value"]')).toBeNull();
  });

  it('checks the new token right away, so the rejection goes and the expiry shows', async () => {
    await show([{ name: 'GITHUB_TOKEN', check: checked({ result: 'rejected' }) }]);
    await userEvent.click(screen.getByRole('button', { name: 'Replace GITHUB_TOKEN' }));
    await userEvent.type(screen.getByLabelText('New value for GITHUB_TOKEN'), 'ghp_new{Enter}');
    expect(await rowOf('GITHUB_TOKEN').findByText(/^Valid until /)).toBeTruthy();
    expect(rowOf('GITHUB_TOKEN').queryByText('Rejected')).toBeNull();
    const calls = invoke.mock.calls.map(([method]) => method);
    expect(calls.indexOf('checkKey')).toBeGreaterThan(calls.indexOf('setSecret'));
  });

  it('keeps the new value saved when the check after it fails', async () => {
    await show([{ name: 'GITHUB_TOKEN' }]);
    failing.checkKey = 'GitHub answered 503, so Hatstand could not check this key.';
    await userEvent.click(screen.getByRole('button', { name: 'Replace GITHUB_TOKEN' }));
    await userEvent.type(screen.getByLabelText('New value for GITHUB_TOKEN'), 'ghp_new{Enter}');
    expect(await rowOf('GITHUB_TOKEN').findByText(/GitHub answered 503/)).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('setSecret', 'acme', 'GITHUB_TOKEN', 'ghp_new');
    expect(screen.queryByLabelText('New value for GITHUB_TOKEN')).toBeNull();
  });

  it('does not ask a provider about a key that has none', async () => {
    await show([{ name: 'ACME_API_TOKEN' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Replace ACME_API_TOKEN' }));
    await userEvent.type(screen.getByLabelText('New value for ACME_API_TOKEN'), 'new-value{Enter}');
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('setSecret', 'acme', 'ACME_API_TOKEN', 'new-value'));
    expect(invoke).not.toHaveBeenCalledWith('checkKey', 'acme', 'ACME_API_TOKEN');
  });

  it('saves nothing on Cancel, and forgets what was typed', async () => {
    await show([{ name: 'GITHUB_TOKEN' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Replace GITHUB_TOKEN' }));
    await userEvent.type(screen.getByLabelText('New value for GITHUB_TOKEN'), 'ghp_typed');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Replace GITHUB_TOKEN' }));
    expect((screen.getByLabelText('New value for GITHUB_TOKEN') as HTMLInputElement).value).toBe('');
    expect(invoke).not.toHaveBeenCalledWith('setSecret', 'acme', 'GITHUB_TOKEN', expect.anything());
  });

  it('shows why a save failed, and keeps the field open', async () => {
    await show([{ name: 'GITHUB_TOKEN' }]);
    failing.setSecret = 'The system keychain is not available.';
    await userEvent.click(screen.getByRole('button', { name: 'Replace GITHUB_TOKEN' }));
    await userEvent.type(screen.getByLabelText('New value for GITHUB_TOKEN'), 'ghp_new{Enter}');
    expect(await rowOf('GITHUB_TOKEN').findByText('The system keychain is not available.')).toBeTruthy();
    expect(screen.getByLabelText('New value for GITHUB_TOKEN')).toBeTruthy();
  });
});

describe('adding and deleting keys', () => {
  it('adds a known key from its empty row, with its name already set', async () => {
    await show();
    await userEvent.click(screen.getByRole('button', { name: 'Add JIRA_SITE' }));
    const field = screen.getByLabelText('New value for JIRA_SITE');
    expect(field.getAttribute('type')).toBe('text');
    await userEvent.type(field, 'acme.atlassian.net{Enter}');
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('setSecret', 'acme', 'JIRA_SITE', 'acme.atlassian.net'));
    expect(await screen.findByRole('button', { name: 'Replace JIRA_SITE' })).toBeTruthy();
    expect(invoke).not.toHaveBeenCalledWith('checkKey', 'acme', 'JIRA_SITE');
  });

  it('adds a key of any name, and never shows its value afterwards', async () => {
    await show();
    await userEvent.type(screen.getByLabelText('Key name'), 'ACME_API_TOKEN');
    await userEvent.type(screen.getByLabelText('Key value'), 'acme-secret-value-123');
    await userEvent.click(screen.getByRole('button', { name: 'Add key' }));
    expect(await screen.findByRole('button', { name: 'Replace ACME_API_TOKEN' })).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('setSecret', 'acme', 'ACME_API_TOKEN', 'acme-secret-value-123');
    expect((screen.getByLabelText('Key value') as HTMLInputElement).value).toBe('');
    expect(document.body.textContent).not.toContain('acme-secret-value-123');
  });

  it('keeps what was typed when a name is refused', async () => {
    await show();
    failing.setSecret = 'Use letters, numbers and underscores, starting with a letter.';
    await userEvent.type(screen.getByLabelText('Key name'), 'MY-KEY');
    await userEvent.type(screen.getByLabelText('Key value'), 'value');
    await userEvent.click(screen.getByRole('button', { name: 'Add key' }));
    expect(await screen.findByText(/Use letters, numbers and underscores/)).toBeTruthy();
    expect((screen.getByLabelText('Key name') as HTMLInputElement).value).toBe('MY-KEY');
  });

  it('deletes a key from its row', async () => {
    await show([{ name: 'ACME_API_TOKEN' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Delete key ACME_API_TOKEN' }));
    await waitFor(() => expect(screen.queryByText('ACME_API_TOKEN')).toBeNull());
    expect(invoke).toHaveBeenCalledWith('deleteSecret', 'acme', 'ACME_API_TOKEN');
  });

  it('imports an env file and says how many keys came in', async () => {
    await show();
    await userEvent.click(screen.getByRole('button', { name: 'Import from an env file' }));
    expect(await screen.findByText('Imported 2 keys.')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('importEnvFile', 'acme');
  });
});

describe('the note of a key Hatstand does not know', () => {
  it('shows the note, and saves a changed one when the field is left', async () => {
    await show([{ name: 'ACME_API_TOKEN', note: 'Billing sandbox' }]);
    const note = screen.getByLabelText('Note for ACME_API_TOKEN') as HTMLInputElement;
    expect(note.value).toBe('Billing sandbox');
    await userEvent.clear(note);
    await userEvent.type(note, 'Billing, production');
    await userEvent.tab();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('setKeyNote', 'acme', 'ACME_API_TOKEN', 'Billing, production'));
  });

  it('saves nothing when the note did not change', async () => {
    await show([{ name: 'ACME_API_TOKEN', note: 'Billing sandbox' }]);
    await userEvent.click(screen.getByLabelText('Note for ACME_API_TOKEN'));
    await userEvent.tab();
    expect(invoke).not.toHaveBeenCalledWith('setKeyNote', 'acme', 'ACME_API_TOKEN', expect.anything());
  });

  it('offers no note for a key Hatstand knows', async () => {
    await show([{ name: 'GITHUB_TOKEN' }]);
    expect(screen.queryByLabelText('Note for GITHUB_TOKEN')).toBeNull();
  });
});

describe('a key that changes while the step is open', () => {
  it('reads the keys again when Hatstand says something changed', async () => {
    let changed = () => {};
    window.hatstand = { invoke, on: (_event: string, listener: () => void) => ((changed = listener), () => {}) } as unknown as Bridge;
    await show([{ name: 'GITHUB_TOKEN', check: checked() }]);
    keys = [{ name: 'GITHUB_TOKEN', check: checked({ result: 'rejected' }) }];
    changed();
    expect(await rowOf('GITHUB_TOKEN').findByText('Rejected')).toBeTruthy();
  });
});
