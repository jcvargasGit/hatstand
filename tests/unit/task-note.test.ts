import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SUMMARY_PROMPT } from '../../src/main/agents/summary-refresh';
import { buildSystemPrompt } from '../../src/main/agents/task-prompt';
import { dataPaths } from '../../src/main/paths';
import { Store } from '../../src/main/store';
import { DRAFT_IN_THE_WAY, summaryBlockedReason } from '../../src/shared/task-summary';
import type { Company } from '../../src/shared/schemas';

const company: Company = {
  id: 'acme',
  name: 'Acme',
  color: '#E8A33D',
  origin: 'existing',
  hasCode: false,
  confirmedSteps: [],
  rootDir: '/code',
  skipPermissions: false,
  protectedPaths: [],
  links: [],
  subdomains: [],
  projects: [],
  context: {},
};

let dir: string;
let paths: ReturnType<typeof dataPaths>;
let store: Store;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-note-')));
  paths = dataPaths(join(dir, 'home'));
  store = new Store(paths);
  store.saveCompany(company);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the note of a task', () => {
  it('saves the exact text and leaves the dates and the notes of the agent alone', () => {
    const task = store.createTask({ companyId: 'acme', title: 'Read the logs' });
    expect(task.note).toBe('');
    const before = store.findTask(task.id).updatedAt;
    store.saveTaskNote(task.id, '# Stopped at\n\n- the second **retry**');
    const saved = store.findTask(task.id);
    expect(saved.note).toBe('# Stopped at\n\n- the second **retry**');
    expect(saved.updatedAt).toBe(before);
    expect(existsSync(paths.notesFile('acme', task.id))).toBe(false);
  });

  it('keeps what changed in the task since it was opened', () => {
    const task = store.createTask({ companyId: 'acme', title: 'Read the logs' });
    store.updateTask(task.id, { title: 'Read all the logs' });
    store.saveTaskNote(task.id, 'Line 40');
    expect(store.findTask(task.id).title).toBe('Read all the logs');
  });

  it('reads a task from before as an empty note', () => {
    const task = store.createTask({ companyId: 'acme', title: 'Old' });
    const file = paths.taskFile('acme', task.id);
    const { note: _note, ...old } = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    writeFileSync(file, JSON.stringify(old));
    expect(store.findTask(task.id).note).toBe('');
  });

  it('never reaches the prompt of the agent', () => {
    const task = { ...store.createTask({ companyId: 'acme', title: 'Read the logs' }), note: 'my private reminder' };
    const prompt = buildSystemPrompt({ company, task, area: undefined, repositories: [], subdomainFolders: [], areaFolder: undefined, companyInstructions: '', knowledgeDirs: [], notesFile: '/n.md', notes: '' });
    expect(prompt).not.toContain('my private reminder');
  });
});

describe('asking the agent for a summary', () => {
  it('is only possible while the agent waits at its prompt', () => {
    expect(summaryBlockedReason('idle')).toBeNull();
    expect(summaryBlockedReason('background')).toBeNull();
    expect(summaryBlockedReason('working')).toContain('busy');
    expect(summaryBlockedReason('needs-input')).toContain('busy');
    expect(summaryBlockedReason('stopped')).toContain('Resume');
    expect(summaryBlockedReason(undefined)).toContain('Resume');
  });

  it('asks only for the summary, on one line', () => {
    expect(SUMMARY_PROMPT).toContain('TL;DR');
    expect(SUMMARY_PROMPT).toContain('do not change code');
    expect(SUMMARY_PROMPT).not.toMatch(/[\r\n]/);
  });

  it('waits until the text left at the prompt is sent or cleared', () => {
    expect(summaryBlockedReason('idle', true)).toBe(DRAFT_IN_THE_WAY);
    expect(summaryBlockedReason('working', true)).toContain('busy');
  });
});
