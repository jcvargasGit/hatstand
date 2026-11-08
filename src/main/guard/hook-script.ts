export const HOOK_MARKER = '# hatstand-guard';
export const KNOWLEDGE_LINE_THRESHOLD = 3;

export function buildHookFile(nodePath: string, guardScript: string, previousHook?: string): string {
  const runGuard = previousHook
    ? `"$NODE_BIN" "${guardScript}" "$(dirname "$0")" || exit 1
if [ -x "${previousHook}" ]; then
  exec "${previousHook}" "$@"
fi`
    : `exec "$NODE_BIN" "${guardScript}" "$(dirname "$0")"`;
  return `#!/bin/sh
${HOOK_MARKER}
NODE_BIN="${nodePath}"
[ -x "$NODE_BIN" ] || NODE_BIN="$(command -v node)"
if [ -z "$NODE_BIN" ]; then
  echo "hatstand guard: Node.js was not found, so this commit was not checked and is blocked." >&2
  exit 1
fi
${runGuard}
`;
}

export function buildGuardScript(): string {
  return `#!/usr/bin/env node
'use strict';
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const MIN_LINE_LENGTH = 40;
const THRESHOLD = ${KNOWLEDGE_LINE_THRESHOLD};
const MAX_LINE = 100000;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

const loadFingerprints = () =>
  readdirSync(__dirname)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(__dirname, name), 'utf8')));

const stagedAdditions = () => {
  const diff = execFileSync(
    'git',
    ['diff', '--cached', '--no-color', '--no-ext-diff', '--unified=0'],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  let file = '';
  const additions = [];
  for (const line of diff.split('\\n')) {
    if (line.startsWith('+++ ')) file = line.replace(/^\\+\\+\\+ (b\\/)?/, '');
    else if (line.startsWith('+')) additions.push({ file, text: line.slice(1) });
  }
  return additions;
};

const containsSecret = (text, secret) => {
  if (text.length < secret.length) return false;
  for (let start = 0; start + secret.length <= text.length; start += 1) {
    if (sha256(text.slice(start, start + secret.length)) === secret.hash) return true;
  }
  return false;
};

const findProblems = (additions, sets) => {
  const problems = [];
  for (const set of sets) {
    const lineHashes = new Set(set.lineHashes);
    const knowledgeHits = new Map();
    for (const { file, text } of additions) {
      const trimmed = text.trim();
      if (trimmed.length >= MIN_LINE_LENGTH && lineHashes.has(sha256(trimmed))) {
        knowledgeHits.set(sha256(trimmed), file);
      }
      if (text.length > MAX_LINE) continue;
      for (const secret of set.secrets) {
        if (containsSecret(text, secret)) {
          problems.push('secret ' + secret.name + ' of ' + set.company + ' in ' + file);
        }
      }
    }
    if (knowledgeHits.size >= THRESHOLD) {
      const files = [...new Set(knowledgeHits.values())].join(', ');
      problems.push(knowledgeHits.size + ' lines of ' + set.company + ' knowledge in ' + files);
    }
  }
  return [...new Set(problems)];
};

const readOnlyRepos = () => {
  try {
    return JSON.parse(process.env.HATSTAND_READ_ONLY_REPOS || '[]');
  } catch {
    return [];
  }
};
const currentRepo = () => execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

if (readOnlyRepos().includes(currentRepo())) {
  console.error('hatstand guard blocked this commit: this folder is the original repository, and in this task it is only for reading.');
  console.error('Run hatstand-edit-repo with the name of the repository, and commit in the copy it creates.');
  process.exit(1);
}

const problems = findProblems(stagedAdditions(), loadFingerprints());
if (problems.length > 0) {
  console.error('hatstand guard blocked this commit:');
  for (const problem of problems) console.error('  - ' + problem);
  console.error('Remove that content and stage again. Only a person should override this check.');
  process.exit(1);
}
`;
}
