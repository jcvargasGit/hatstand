// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeFolder, activePlanning, countFolderFiles, looksLikePlugin, withFolderHistory } from '../../src/main/active-folders';
import { buildSystemPrompt } from '../../src/main/agents/task-prompt';
import { createDocument, listClientFiles } from '../../src/main/client-files';
import { withFolderPointer } from '../../src/main/folder-pointer';
import { sha256 } from '../../src/main/guard/fingerprints';
import { buildFingerprints } from '../../src/main/guard/service';
import { dataPaths, type DataPaths } from '../../src/main/paths';
import { Store } from '../../src/main/store';
import { ActiveFolder } from '../../src/renderer/src/components/ActiveFolder';
import type { Bridge } from '../../src/shared/api';
import { companySchema, type Company, type Task } from '../../src/shared/schemas';

let home: string;
let paths: DataPaths;
let store: Store;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-active-')));
  paths = dataPaths(join(home, 'data'));
  store = new Store(paths);
});

afterEach(() => {
  cleanup();
  rmSync(home, { recursive: true, force: true });
});

const folder = (name: string) => {
  const path = join(home, name);
  mkdirSync(path, { recursive: true });
  return path;
};
const longLine = (topic: string) => `A line about ${topic} that is long enough to be fingerprinted by the guard.`;

describe('reading an older client file', () => {
  const parse = (context: object, confirmedSteps: string[] = []) => companySchema.parse({ id: 'a', name: 'A', color: '#112233', context, confirmedSteps });

  it('keeps no custom folder when the lists are empty', () => {
    expect(parse({ knowledgeDirs: [], pluginDirs: [] }).context).toEqual({});
  });

  it('keeps the custom folder of a list with one item', () => {
    expect(parse({ knowledgeDirs: ['/kb'], pluginDirs: ['/plugin'] }).context).toEqual({ knowledgeDir: '/kb', pluginDir: '/plugin' });
  });

  it('keeps the first folder of a longer list', () => {
    expect(parse({ knowledgeDirs: ['/first', '/second'] }).context.knowledgeDir).toBe('/first');
  });

  it('translates the old id of a confirmed step', () => {
    expect(parse({}, ['skills', 'knowledge']).confirmedSteps).toEqual(['llm-config', 'knowledge']);
  });

  it('stays the same after saving and reading again', () => {
    const company = store.createCompany('Acme', '#112233');
    writeFileSync(paths.companyFile(company.id), `id: acme\nname: Acme\ncolor: '#112233'\ncontext:\n  knowledgeDirs:\n    - ${folder('kb')}\n  pluginDirs: []\n`);
    const read = store.readCompany(company.id);
    store.saveCompany(read);
    expect(readFileSync(paths.companyFile(company.id), 'utf8')).not.toContain('knowledgeDirs');
    expect(store.readCompany(company.id).context).toEqual({ knowledgeDir: join(home, 'kb') });
  });
});

describe('the active folder', () => {
  it('is the default one without a custom folder', () => {
    const company = store.createCompany('Acme', '#112233');
    expect(activeFolder(paths, company, 'knowledge')).toBe(paths.knowledgeDir('acme'));
    expect(activeFolder(paths, company, 'llm-config')).toBe(paths.pluginDir('acme'));
    expect(activeFolder(paths, company, 'planning')).toBe(paths.planningDir('acme'));
    expect(existsSync(paths.planningDir('acme'))).toBe(true);
  });

  it('is only the custom one when there is one', () => {
    const company: Company = { ...store.createCompany('Acme', '#112233'), context: { knowledgeDir: '/kb', pluginDir: '/plugin' }, planning: { path: '/specs', places: [] } };
    expect(activeFolder(paths, company, 'knowledge')).toBe('/kb');
    expect(activeFolder(paths, company, 'llm-config')).toBe('/plugin');
    expect(activeFolder(paths, company, 'planning')).toBe('/specs');
  });

  it('knows whether planning has git', () => {
    const repo = folder('specs');
    const plain = folder('plain');
    mkdirSync(join(repo, '.git'));
    const company = store.createCompany('Acme', '#112233');
    expect(activePlanning(paths, company).hasGit).toBe(false);
    expect(activePlanning(paths, { ...company, planning: { path: repo, places: [] } }).hasGit).toBe(true);
    expect(activePlanning(paths, { ...company, planning: { path: plain, places: [] } }).hasGit).toBe(false);
  });

  it('is the only one whose files are listed, and new documents go there', () => {
    const custom = folder('kb');
    writeFileSync(join(custom, 'in-use.md'), 'x');
    const base = store.createCompany('Acme', '#112233');
    writeFileSync(join(paths.knowledgeDir('acme'), 'old.md'), 'x');
    const company = { ...base, context: { knowledgeDir: custom } };
    const names = listClientFiles(paths, company).filter((file) => file.scope === 'knowledge').map((file) => file.name);
    expect(names).toEqual(['in-use.md']);
    expect(createDocument(paths, company, 'knowledge', 'New')).toBe(join(custom, 'New.md'));
  });

  it('receives a planning document even without a custom folder', () => {
    const company = store.createCompany('Acme', '#112233');
    expect(createDocument(paths, company, '.', 'Plan')).toBe(join(paths.planningDir('acme'), 'Plan.md'));
    expect(listClientFiles(paths, company).filter((file) => file.scope === 'planning').map((file) => file.name)).toEqual(['Plan.md']);
  });
});

describe('the default LLM config folder', () => {
  const loads = () => store.hasLocalPlugin('acme');
  const plugin = () => paths.pluginDir('acme');

  beforeEach(() => void store.createCompany('Acme', '#112233'));

  it('does not load while it only has the empty folders Hatstand created', () => {
    writeFileSync(join(plugin(), '.DS_Store'), 'x');
    expect(loads()).toBe(false);
  });

  it('loads with only an agent', () => {
    mkdirSync(join(plugin(), 'agents'));
    writeFileSync(join(plugin(), 'agents', 'reviewer.md'), 'x');
    expect(loads()).toBe(true);
  });

  it('loads with only MCP servers', () => {
    writeFileSync(join(plugin(), '.mcp.json'), '{}');
    expect(loads()).toBe(true);
  });

  it('does not count the README', () => {
    writeFileSync(join(plugin(), 'README.md'), 'x');
    expect(loads()).toBe(false);
  });
});

describe('recognizing a plugin folder', () => {
  it('accepts the standard layout and a folder of skills or plugins', () => {
    const plain = folder('standard');
    mkdirSync(join(plain, 'agents'));
    expect(looksLikePlugin(plain)).toBe(true);
    const skills = folder('skills-folder');
    mkdirSync(join(skills, 'deploy'));
    writeFileSync(join(skills, 'deploy', 'SKILL.md'), 'x');
    expect(looksLikePlugin(skills)).toBe(true);
  });

  it('rejects a folder with nothing an agent can load', () => {
    const other = folder('documents');
    writeFileSync(join(other, 'notes.md'), 'x');
    expect(looksLikePlugin(other)).toBe(false);
    expect(looksLikePlugin(join(home, 'gone'))).toBe(false);
  });
});

describe('counting files before a change', () => {
  it('ignores the top README and hidden files, and counts nested files', () => {
    const dir = folder('count');
    writeFileSync(join(dir, 'README.md'), 'x');
    writeFileSync(join(dir, '.DS_Store'), 'x');
    mkdirSync(join(dir, 'nested'));
    writeFileSync(join(dir, 'nested', 'README.md'), 'x');
    writeFileSync(join(dir, 'a.md'), 'x');
    expect(countFolderFiles(dir)).toBe(2);
    expect(countFolderFiles(join(home, 'gone'))).toBe(0);
  });
});

describe('the note in the default folder', () => {
  it('points to the folder in use, and leaves when there is no custom folder', () => {
    const withNote = withFolderPointer('', '/kb');
    expect(withNote).toContain('/kb');
    expect(withFolderPointer(withNote, undefined)).toBe('');
  });

  it('keeps what the person wrote, and updates instead of adding another note', () => {
    const first = withFolderPointer('# Mine\n\nMy text\n', '/old');
    const second = withFolderPointer(first, '/new');
    expect(second).toContain('/new');
    expect(second).not.toContain('/old');
    expect(second).toContain('# Mine\n\nMy text');
    expect(withFolderPointer(second, undefined)).toBe('# Mine\n\nMy text\n');
  });

  it('does not touch a file without a note when there is no custom folder', () => {
    expect(withFolderPointer('  my spacing\n\n', undefined)).toBe('  my spacing\n\n');
  });

  it('is written and removed when the client is saved, in every section', () => {
    const company = store.createCompany('Acme', '#112233');
    const readmes = [paths.knowledgeDir('acme'), paths.pluginDir('acme'), paths.planningDir('acme')].map((dir) => join(dir, 'README.md'));
    store.saveCompany({ ...company, context: { knowledgeDir: '/kb', pluginDir: '/plugin' }, planning: { path: '/specs', places: [] } });
    expect(readmes.map((file) => readFileSync(file, 'utf8').includes('/'))).toEqual([true, true, true]);
    expect(readFileSync(readmes[2] as string, 'utf8')).toContain('/specs');
    store.saveCompany(company);
    expect(readmes.map((file) => existsSync(file))).toEqual([false, false, false]);
  });
});

describe('commit protection', () => {
  it('still covers the default folders when a custom folder is active', () => {
    const company = store.createCompany('Acme', '#112233');
    const custom = folder('kb');
    writeFileSync(join(custom, 'b.md'), longLine('custom knowledge'));
    writeFileSync(join(paths.knowledgeDir('acme'), 'a.md'), longLine('default knowledge'));
    writeFileSync(join(paths.planningDir('acme'), 'plan.md'), longLine('private planning'));
    const { lineHashes } = buildFingerprints(paths, { ...company, context: { knowledgeDir: custom } }, {});
    for (const topic of ['custom knowledge', 'default knowledge', 'private planning']) expect(lineHashes).toContain(sha256(longLine(topic)));
  });

  it('does not cover a custom planning repository', () => {
    const company = store.createCompany('Acme', '#112233');
    const specs = folder('specs');
    writeFileSync(join(specs, 'plan.md'), longLine('team planning'));
    const { lineHashes } = buildFingerprints(paths, { ...company, planning: { path: specs, places: [] } }, {});
    expect(lineHashes).not.toContain(sha256(longLine('team planning')));
  });
});

describe('what the agent is told about planning', () => {
  const task = { id: 't', companyId: 'a', title: 'T', description: '', type: 'planning', checklist: [], worktrees: [], isolated: false } as unknown as Task;
  const prompt = (planning: { path: string; places: []; hasGit: boolean }) =>
    buildSystemPrompt({ company: { name: 'A', links: [], projects: [] } as unknown as Company, task, repositories: [], companyInstructions: '', knowledgeDirs: [], planning, notesFile: '/n', notes: '' });

  it('has no commit instruction in a folder without git', () => {
    const text = prompt({ path: '/data/planning', places: [], hasGit: false });
    expect(text).toContain('## Planning folder');
    expect(text).toContain('/data/planning');
    expect(text).not.toContain('Commit the result');
  });

  it('asks a planning task to commit in a repository', () => {
    const text = prompt({ path: '/specs', places: [], hasGit: true });
    expect(text).toContain('## Planning repository');
    expect(text).toContain('Commit the result of this task');
  });
});

describe('remembering the folders a client used', () => {
  const client = () => store.createCompany('History', '#112233');

  it('records the folder it leaves, for each kind of folder', () => {
    const saved = store.saveCompany({ ...client(), planning: { path: folder('specs'), places: [] }, context: { knowledgeDir: folder('kb') } });
    const next = store.saveCompany({ ...saved, planning: { path: folder('other'), places: [] }, context: {} });
    expect(next.pastFolders?.map(({ section, path }) => [section, path]).sort()).toEqual([['knowledge', folder('kb')], ['planning', folder('specs')]]);
  });

  it('keeps it when going back to the default folder', () => {
    const saved = store.saveCompany({ ...client(), planning: { path: folder('specs'), places: [] } });
    expect(store.saveCompany({ ...saved, planning: undefined }).pastFolders?.map(({ path }) => path)).toEqual([folder('specs')]);
  });

  it('stops listing a folder when it is used again, and lists each folder once', () => {
    const company = companySchema.parse({ id: 'a', name: 'A', color: '#112233', planning: { path: '/one' } });
    const left = withFolderHistory(company, { ...company, planning: { path: '/two', places: [] } }, '2026-11-01');
    const back = withFolderHistory(left, { ...left, planning: { path: '/one', places: [] } }, '2026-11-02');
    expect(back.pastFolders).toEqual([{ section: 'planning', path: '/two', leftAt: '2026-11-02' }]);
    const again = withFolderHistory(back, { ...back, planning: { path: '/two', places: [] } }, '2026-11-03');
    expect(withFolderHistory(again, { ...again, planning: undefined }, '2026-11-04').pastFolders?.filter(({ path }) => path === '/two')).toHaveLength(1);
  });

  it('is not erased by a save that comes from an older copy of the client', () => {
    const original = store.saveCompany({ ...client(), planning: { path: folder('specs'), places: [] } });
    store.saveCompany({ ...original, planning: undefined });
    expect(store.saveCompany({ ...original, planning: undefined, name: 'Renamed', pastFolders: [] }).pastFolders?.map(({ path }) => path)).toEqual([folder('specs')]);
  });
});

describe('choosing a folder', () => {
  const invoke = vi.fn();
  const onChange = vi.fn();
  const answer = (files: number, overrides: Record<string, unknown> = {}) =>
    invoke.mockImplementation(async (method: string) => {
      if (method === 'folderSwitchImpact') return { from: '/current', files, openTasks: 2 };
      if (method === 'listPastFolders') return overrides[method] ?? [];
      if (method === 'resolvePath') return '/new';
      return overrides[method] ?? false;
    });
  const show = (customPath?: string, flags: { warnInsideGit?: boolean; warnNotPlugin?: boolean } = {}) =>
    render(<ActiveFolder companyId="acme" section="knowledge" title="Knowledge folder" hint="Hint" defaultPath="/default" customPath={customPath} onChange={onChange} {...flags} />);
  const choose = async () => {
    await userEvent.type(screen.getByLabelText('Knowledge folder, full path'), '/new');
    await userEvent.click(screen.getByRole('button', { name: 'Add path' }));
  };

  beforeEach(() => {
    invoke.mockReset();
    onChange.mockReset();
    window.hatstand = { invoke, on: () => () => {} } as unknown as Bridge;
  });

  it('shows which folder is in use', () => {
    answer(0);
    show();
    expect(screen.getByText('Default')).toBeTruthy();
    expect(screen.getByText('/default')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Go back to the default folder' })).toBeNull();
    cleanup();
    show('/custom');
    expect(screen.getByText('Custom')).toBeTruthy();
    expect(screen.getByText('/custom')).toBeTruthy();
    expect(screen.queryByText('/default')).toBeNull();
  });

  it('changes at once when the current folder has no files', async () => {
    answer(0);
    show();
    await choose();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('/new'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('warns first when the current folder has files, and saves on confirming', async () => {
    answer(3);
    show();
    await choose();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('3 files in /current');
    expect(alert.textContent).toContain('/new');
    expect(alert.textContent).toContain('2 open tasks');
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Use the new folder' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('/new'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('offers the folders used before, and warns before going back to one', async () => {
    answer(3, { listPastFolders: [{ path: '/old', leftAt: '2026-11-01T10:00:00.000Z', exists: true }, { path: '/gone', leftAt: '2026-10-01T10:00:00.000Z', exists: false }] });
    show('/custom');
    await userEvent.click(await screen.findByRole('button', { name: 'Use /old again' }));
    expect((await screen.findByRole('alert')).textContent).toContain('/old');
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Use the new folder' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('/old'));
  });

  it('says when a folder used before no longer exists, without offering it', async () => {
    answer(0, { listPastFolders: [{ path: '/gone', leftAt: '2026-10-01T10:00:00.000Z', exists: false }] });
    show();
    expect(await screen.findByText('This folder no longer exists')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use /gone again' })).toBeNull();
  });

  it('saves nothing on cancel', async () => {
    answer(3);
    show();
    await choose();
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('always warns before going back to the default folder', async () => {
    answer(0);
    show('/custom');
    await userEvent.click(screen.getByRole('button', { name: 'Go back to the default folder' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('/default');
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Use the default folder' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(undefined));
  });

  it('warns about a custom folder inside git, without blocking it', async () => {
    answer(0, { isInsideGitRepo: true });
    show('/custom', { warnInsideGit: true });
    expect(await screen.findByText(/inside a git repository/)).toBeTruthy();
  });

  it('warns about a custom folder that is not a plugin, without blocking it', async () => {
    answer(0, { isPluginFolder: false });
    show('/custom', { warnNotPlugin: true });
    expect(await screen.findByText(/no skills, agents, commands, hooks or MCP servers/)).toBeTruthy();
    cleanup();
    answer(0, { isPluginFolder: true });
    show('/custom', { warnNotPlugin: true });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('isPluginFolder', '/custom'));
    expect(screen.queryByText(/no skills, agents/)).toBeNull();
  });
});
