import { z } from 'zod';
import { taskSchema, type Task } from './schemas';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLIENT_AND_NUMBER = /^([a-z0-9]+(?:-[a-z0-9]+)*)\s*#\s*([1-9]\d*)$/;

export const taskReferenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('uuid'), id: z.string().regex(UUID) }),
  z.object({ kind: z.literal('number'), companyId: taskSchema.shape.companyId, number: taskSchema.shape.number.unwrap() }),
]);

export type TaskReference = z.infer<typeof taskReferenceSchema>;

type NumberedTask = Pick<Task, 'companyId' | 'number'>;

export function formatTaskReference(task: NumberedTask): string | undefined {
  return task.number === undefined ? undefined : `${task.companyId}#${task.number}`;
}

export function readTaskReference(input: string): TaskReference | null {
  const text = input.trim().toLowerCase();
  if (UUID.test(text)) return { kind: 'uuid', id: text };
  const match = CLIENT_AND_NUMBER.exec(text);
  return match?.[1] && match[2] ? { kind: 'number', companyId: match[1], number: Number(match[2]) } : null;
}

export function parseTaskReference(input: string): TaskReference {
  const reference = readTaskReference(input);
  if (!reference) throw new Error('Paste a task reference such as acme#12, or the UUID of the task.');
  return reference;
}

export function isReferenceOf(reference: TaskReference, task: Pick<Task, 'id' | 'companyId' | 'number'>): boolean {
  return reference.kind === 'uuid' ? task.id.toLowerCase() === reference.id : task.companyId === reference.companyId && task.number === reference.number;
}
