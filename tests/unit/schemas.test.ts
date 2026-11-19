import { describe, expect, it } from 'vitest';
import { companySchema, keyDetailsFileSchema, keyInfoSchema, newTaskSchema, secretNameSchema } from '../../src/shared/schemas';

describe('companySchema', () => {
  it('asks for permission by default and starts with no context', () => {
    const company = companySchema.parse({ id: 'acme', name: 'Acme', color: '#112233' });
    expect(company.skipPermissions).toBe(false);
    expect(company.context).toEqual({});
    expect(company.subdomains).toEqual([]);
  });

  it('rejects a color that is not a six digit hex value', () => {
    expect(companySchema.safeParse({ id: 'acme', name: 'Acme', color: 'red' }).success).toBe(false);
  });
});

describe('newTaskSchema', () => {
  it('rejects a blank title', () => {
    expect(newTaskSchema.safeParse({ companyId: 'acme', title: '   ' }).success).toBe(false);
  });
});

describe('keyDetailsFileSchema', () => {
  it('reads an empty file as no keys', () => {
    expect(keyDetailsFileSchema.parse({})).toEqual({ keys: {} });
  });

  it('keeps the date, the note and the last check of a key', () => {
    const keys = { GITHUB_TOKEN: { savedAt: '2026-11-18T10:00:00.000Z', note: 'n', check: { at: '2026-11-18T10:00:00.000Z', result: 'valid', expiresAt: '2026-12-01T08:00:00.000Z' } } };
    expect(keyDetailsFileSchema.parse({ keys })).toEqual({ keys });
  });

  it('refuses a check result it does not know', () => {
    expect(keyDetailsFileSchema.safeParse({ keys: { A: { check: { at: 'x', result: 'maybe' } } } }).success).toBe(false);
  });

  it('has no place for a value', () => {
    const parsed = keyDetailsFileSchema.parse({ keys: { A: { value: 'plain-value', savedAt: 'x' } } });
    expect(JSON.stringify(parsed)).not.toContain('plain-value');
    expect(keyInfoSchema.parse({ name: 'A', value: 'plain-value' })).toEqual({ name: 'A' });
  });
});

describe('secretNameSchema', () => {
  it.each(['JIRA_API_TOKEN', '_x1'])('accepts %s', (name) => {
    expect(secretNameSchema.safeParse(name).success).toBe(true);
  });

  it.each(['1TOKEN', 'A-B', 'A B', 'A=B', ''])('rejects "%s"', (name) => {
    expect(secretNameSchema.safeParse(name).success).toBe(false);
  });
});
