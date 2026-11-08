import type { ClientReadiness, ReadinessItem } from '../../../shared/readiness';
import type { Company } from '../../../shared/schemas';

export const SETUP_STEPS = [
  { id: 'name', label: 'Name', itemIds: [] },
  { id: 'agent', label: 'Agent', itemIds: [] },
  { id: 'repositories', label: 'Repositories', itemIds: ['workspace'] },
  { id: 'areas', label: 'Areas', itemIds: [] },
  { id: 'planning', label: 'Planning', itemIds: [] },
  { id: 'llm-config', label: 'LLM config', itemIds: ['llm-config'] },
  { id: 'knowledge', label: 'Knowledge', itemIds: ['knowledge'] },
  { id: 'keys', label: 'Keys and tools', itemIds: ['tracker'] },
  { id: 'links', label: 'Links', itemIds: ['links'] },
  { id: 'identity', label: 'Commit identity', itemIds: ['identity'] },
  { id: 'protection', label: 'Protection', itemIds: ['protection'] },
  { id: 'guides', label: 'Task guides', itemIds: [] },
  { id: 'review', label: 'Review', itemIds: [] },
] as const;

export type SetupStepId = (typeof SETUP_STEPS)[number]['id'];
export type SetupStep = { id: SetupStepId; label: string; itemIds: readonly string[] };

const CODE_STEPS: readonly SetupStepId[] = ['repositories', 'identity', 'protection'];

const ITEM_STEPS: Record<string, SetupStepId> = {
  subdomains: 'areas',
  photo: 'name',
};

export function setupSteps(company: Company): readonly SetupStep[] {
  if (company.hasCode) return SETUP_STEPS;
  return SETUP_STEPS.filter((step) => !CODE_STEPS.includes(step.id)).map((step) => (step.id === 'areas' ? { ...step, itemIds: ['workspace'] } : step));
}

export function stepForItem(steps: readonly SetupStep[], item: ReadinessItem): number {
  const owner = steps.findIndex((step) => step.itemIds.includes(item.id) || step.id === ITEM_STEPS[item.id]);
  return owner >= 0 ? owner : steps.length - 1;
}

export function firstOpenStep(steps: readonly SetupStep[], readiness: ClientReadiness, origin: Company['origin']): number {
  if (origin === 'scratch' && !readiness.canStart) return steps.findIndex((step) => step.id === 'agent');
  const open = readiness.items.find((item) => !item.done && item.level !== 'optional');
  return open ? stepForItem(steps, open) : steps.length - 1;
}

export function isStepDone(stepItemIds: readonly string[], readiness: ClientReadiness): boolean {
  return stepItemIds.length > 0 && stepItemIds.every((id) => readiness.items.find((item) => item.id === id)?.done);
}
