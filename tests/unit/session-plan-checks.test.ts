import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBacklogPlanTask } from '../../src/main/backlog-plan';
import { answerPlanChecks, preparePlanChecks } from '../../src/main/session-plan-checks';
import type { Task } from '../../src/shared/schemas';
import { makeHome, type TestHome } from '../helpers/home';

let home: TestHome;
let plan: Task;
let folder: string;

beforeEach(() => {
  home = makeHome('hatstand-plan-checks-');
  home.store.createCompany('Acme', '#112233');
  const inbox = ['Add the export', 'Send it by email'].map((title) => home.store.createTask({ companyId: 'acme', title }, undefined, 'idea'));
  plan = createBacklogPlanTask(home.store, 'acme', inbox.map((item) => item.id));
  folder = home.folder('checks');
});
afterEach(() => home.remove());

const ask = (name: string) => writeFileSync(join(folder, `${name}.request`), '');
const writePlan = (value: unknown) => {
  const file = home.paths.planFile('acme', plan.id);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
};
const check = (taskId = plan.id) => answerPlanChecks(home.store, home.paths, { taskId }, folder);

describe('answering the plan checks of the agent', () => {
  it('says there is no plan yet, and takes the request away', () => {
    ask('1');
    check();
    expect(readdirSync(folder)).toEqual(['1.error']);
    expect(readFileSync(join(folder, '1.error'), 'utf8')).toContain('There is no plan yet.');
  });

  it('lists what is wrong with the plan', () => {
    writePlan({ version: 1, order: [{ task: 2, dependsOn: [1] }, { task: 1 }] });
    ask('1');
    check();
    expect(readFileSync(join(folder, '1.error'), 'utf8')).toContain('has to come first in the order');
  });

  it('accepts a valid plan, and answers every request waiting', () => {
    writePlan({ version: 1, order: [{ task: 1 }, { task: 2, dependsOn: [1] }] });
    ask('1');
    ask('2');
    check();
    expect(readdirSync(folder).sort()).toEqual(['1.ok', '2.ok']);
    expect(readFileSync(join(folder, '2.ok'), 'utf8')).toContain('The plan is valid: 2 in the order');
  });

  it('answers with the error when the check itself fails', () => {
    const ordinary = home.store.createTask({ companyId: 'acme', title: 'Fix it' });
    const file = home.paths.planFile('acme', ordinary.id);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '{}');
    ask('1');
    check(ordinary.id);
    expect(readFileSync(join(folder, '1.error'), 'utf8')).toBe('This task does not plan a backlog.\n');
  });

  it('ignores other files, and a folder that is gone', () => {
    writeFileSync(join(folder, 'notes.txt'), 'x');
    check();
    expect(readdirSync(folder)).toEqual(['notes.txt']);
    rmSync(folder, { recursive: true });
    expect(() => check()).not.toThrow();
  });
});

describe('preparing a session that plans the backlog', () => {
  it('makes its request folder, and puts the check command on the PATH', () => {
    const { folder: prepared, env } = preparePlanChecks(home.paths, 'session-1');
    expect(prepared).toBe(home.paths.planChecksDir('session-1'));
    expect(env).toEqual({ HATSTAND_PLAN_CHECKS: prepared });
    expect(statSync(prepared).mode & 0o777).toBe(0o700);
    expect(statSync(home.paths.checkPlanTool).mode & 0o777).toBe(0o700);
  });
});
