import { describe, expect, it } from 'vitest';
import { companySchema, newTaskSchema, secretNameSchema } from '../../src/shared/schemas';

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

describe('secretNameSchema', () => {
  it.each(['JIRA_API_TOKEN', '_x1'])('accepts %s', (name) => {
    expect(secretNameSchema.safeParse(name).success).toBe(true);
  });

  it.each(['1TOKEN', 'A-B', 'A B', 'A=B', ''])('rejects "%s"', (name) => {
    expect(secretNameSchema.safeParse(name).success).toBe(false);
  });
});
