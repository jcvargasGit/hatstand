import { existsSync, readFileSync } from 'node:fs';
import type { Company } from '../shared/schemas';

export const STARTER_INSTRUCTIONS = `# Working with this client

## About the client
(What the company does.)

## Conventions
(Branches, commits, reviews.)

## Before finishing
(Tests to run.)
`;

export const KNOWLEDGE_README = `# Knowledge

Put documents about this client here. Agents can read them in this client's sessions.
This folder stays outside your repositories.
`;

export function isStarterInstructions(text: string): boolean {
  return text.trim() === STARTER_INSTRUCTIONS.trim();
}

export function readClientInstructions(company: Company): string {
  const file = company.context.instructionsFile;
  const text = file && existsSync(file) ? readFileSync(file, 'utf8') : '';
  return isStarterInstructions(text) ? '' : text;
}
