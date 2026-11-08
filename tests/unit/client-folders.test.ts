import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fingerprintText, sha256 } from '../../src/main/guard/fingerprints';
import { buildFingerprints } from '../../src/main/guard/service';
import { dataPaths, type DataPaths } from '../../src/main/paths';
import { Store } from '../../src/main/store';

let home: string;
let paths: DataPaths;
let store: Store;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-folders-')));
  paths = dataPaths(home);
  store = new Store(paths);
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('client folders', () => {
  it('creates the minimum folders and a valid plugin for every new client', () => {
    const { id } = store.createCompany('Acme Corp', '#112233');
    const manifest = JSON.parse(readFileSync(paths.pluginManifest(id), 'utf8')) as { name: string };
    expect(manifest.name).toBe('acme-corp');
    const snapshot = store.snapshot();
    expect(snapshot.clientFolders[id]).toMatchObject({ knowledge: paths.knowledgeDir(id), llmConfig: paths.pluginDir(id), planning: paths.planningDir(id) });
    expect(snapshot.localPlugin).toEqual([]);
    expect(snapshot.localKnowledge).toEqual([]);
  });

  it('notices when a skill or knowledge file is added, ignoring hidden files', () => {
    const { id } = store.createCompany('Acme', '#112233');
    writeFileSync(join(paths.knowledgeDir(id), '.DS_Store'), 'x');
    expect(store.snapshot().localKnowledge).toEqual([]);
    writeFileSync(join(paths.knowledgeDir(id), 'domain.md'), 'x');
    mkdirSync(join(paths.skillsDir(id), 'deploy'));
    writeFileSync(join(paths.skillsDir(id), 'deploy', 'SKILL.md'), 'x');
    const snapshot = store.snapshot();
    expect(snapshot.localKnowledge).toEqual([id]);
    expect(snapshot.localPlugin).toEqual([id]);
  });

  it('does not replace a manifest the user edited', () => {
    const { id } = store.createCompany('Acme', '#112233');
    writeFileSync(paths.pluginManifest(id), '{"name":"custom"}');
    store.ensureClientFolders(id);
    expect(readFileSync(paths.pluginManifest(id), 'utf8')).toBe('{"name":"custom"}');
  });
});

describe('what commit protection covers', () => {
  const line = (topic: string) => `This line about ${topic} is long enough for the commit guard to fingerprint it.`;

  it('includes knowledge, skills, plugins and instructions, wherever they live', () => {
    const company = store.createCompany('Acme', '#112233');
    const externalKnowledge = join(home, 'external-knowledge');
    const externalPlugin = join(home, 'external-plugin');
    const instructions = join(home, 'instructions.md');
    mkdirSync(externalKnowledge);
    mkdirSync(externalPlugin);
    mkdirSync(join(paths.skillsDir(company.id), 'deploy'));
    writeFileSync(join(paths.knowledgeDir(company.id), 'a.md'), line('local knowledge'));
    writeFileSync(join(paths.skillsDir(company.id), 'deploy', 'SKILL.md'), line('local skills'));
    writeFileSync(join(externalKnowledge, 'b.md'), line('external knowledge'));
    writeFileSync(join(externalPlugin, 'c.md'), line('external plugin'));
    writeFileSync(instructions, line('instructions'));

    const fingerprints = buildFingerprints(
      paths,
      {
        ...company,
        context: { instructionsFile: instructions, knowledgeDir: externalKnowledge, pluginDir: externalPlugin },
      },
      { API_TOKEN: 'value-long-enough' },
    );

    for (const topic of ['local knowledge', 'local skills', 'external knowledge', 'external plugin', 'instructions']) {
      expect(fingerprints.lineHashes).toContain(sha256(line(topic)));
    }
    expect(fingerprintText(line('other'))).toHaveLength(1);
    expect(fingerprints.secrets.map((secret) => secret.name)).toEqual(['API_TOKEN']);
  });

  it('skips folders that no longer exist', () => {
    const company = store.createCompany('Acme', '#112233');
    const missing = { ...company, context: { knowledgeDir: join(home, 'gone') } };
    expect(buildFingerprints(paths, missing, {}).lineHashes).toEqual([]);
  });
});
