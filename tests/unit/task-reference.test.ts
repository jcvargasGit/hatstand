import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../../src/main/agents/task-prompt';
import { companySchema, taskSchema, type Task } from '../../src/shared/schemas';
import { formatTaskReference, isReferenceOf, parseTaskReference, readTaskReference } from '../../src/shared/task-reference';

const UUID = '26780f88-9c57-48ee-b47c-9092f792dfc7';
const task = (change: Record<string, unknown> = {}): Task =>
  taskSchema.parse({ id: UUID, number: 12, companyId: 'acme', title: 'Fix login', status: 'doing', createdAt: 'x', updatedAt: 'x', ...change });

describe('a task reference', () => {
  it('is written as the client id, # and the task number', () => {
    expect(formatTaskReference(task())).toBe('acme#12');
    expect(formatTaskReference(task({ companyId: 'acme-2', number: 3 }))).toBe('acme-2#3');
    expect(formatTaskReference(task({ number: undefined }))).toBeUndefined();
  });

  it('is read back from what the person pastes', () => {
    expect(parseTaskReference('acme#12')).toEqual({ kind: 'number', companyId: 'acme', number: 12 });
    expect(parseTaskReference('  Acme-2 #3 ')).toEqual({ kind: 'number', companyId: 'acme-2', number: 3 });
    expect(parseTaskReference(UUID.toUpperCase())).toEqual({ kind: 'uuid', id: UUID });
    expect(parseTaskReference(formatTaskReference(task()) ?? '')).toEqual({ kind: 'number', companyId: 'acme', number: 12 });
  });

  it('refuses text that names no task', () => {
    for (const text of ['', '#12', 'acme#', 'acme#0', 'acme#1.5', 'acme/api#12', 'Fix login', '26780f88']) {
      expect(readTaskReference(text)).toBeNull();
      expect(() => parseTaskReference(text)).toThrow(/acme#12, or the UUID/);
    }
  });

  it('matches only the task of the named client', () => {
    const other = task({ id: 'other', companyId: 'globex' });
    expect(isReferenceOf(parseTaskReference('acme#12'), task())).toBe(true);
    expect(isReferenceOf(parseTaskReference('acme#12'), other)).toBe(false);
    expect(isReferenceOf(parseTaskReference('globex#12'), other)).toBe(true);
    expect(isReferenceOf(parseTaskReference('acme#13'), task())).toBe(false);
    expect(isReferenceOf(parseTaskReference(UUID), task())).toBe(true);
    expect(isReferenceOf(parseTaskReference(UUID), other)).toBe(false);
  });
});

describe('the prompt of a session', () => {
  const company = companySchema.parse({ id: 'acme', name: 'Acme', color: '#5BB8A6' });
  const prompt = (value: Task) =>
    buildSystemPrompt({ company, task: value, area: undefined, repositories: [], subdomainFolders: [], areaFolder: undefined, companyInstructions: '', knowledgeDirs: [], notesFile: '/n.md', notes: '' });

  it('gives the reference and the UUID of its own task, in the inbox or in progress', () => {
    expect(prompt(task())).toContain(`## Current task\nFix login\nReference: acme#12. UUID: ${UUID}.`);
    expect(prompt(task({ status: 'idea' }))).toContain(`Reference: acme#12. UUID: ${UUID}.`);
  });

  it('gives only the UUID while the task has no number', () => {
    const text = prompt(task({ number: undefined }));
    expect(text).toContain(`UUID: ${UUID}.`);
    expect(text).not.toContain('Reference: ');
  });
});
