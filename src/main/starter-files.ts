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
