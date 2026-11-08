export type TaskNotes = {
  summary: string;
  lastDone: string;
  pending: string;
  status: string | undefined;
  details: string;
};

const SECTIONS: Record<string, 'summary' | 'lastDone' | 'pending' | 'status'> = {
  'tl;dr': 'summary',
  'last done': 'lastDone',
  pending: 'pending',
  status: 'status',
};

export function parseTaskNotes(notes: string): TaskNotes {
  const parts = { summary: [] as string[], lastDone: [] as string[], pending: [] as string[], status: [] as string[], details: [] as string[] };
  let current: keyof typeof parts = 'details';
  let inCode = false;
  for (const line of notes.split('\n')) {
    if (line.trimStart().startsWith('```')) inCode = !inCode;
    const heading = inCode ? null : /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = SECTIONS[(heading[1] ?? '').toLowerCase()] ?? 'details';
      if (current !== 'details') continue;
    }
    parts[current].push(line);
  }
  const text = (lines: string[]) => lines.join('\n').trim();
  return {
    summary: text(parts.summary),
    lastDone: text(parts.lastDone),
    pending: text(parts.pending),
    status: text(parts.status).toLowerCase() || undefined,
    details: text(parts.details),
  };
}

export function withNotesStatus(notes: string, status: string): string {
  const lines: string[] = [];
  let inCode = false;
  let inStatus = false;
  for (const line of notes.split('\n')) {
    if (line.trimStart().startsWith('```')) inCode = !inCode;
    const heading = inCode ? null : /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      inStatus = (heading[1] ?? '').toLowerCase() === 'status';
      lines.push(line, ...(inStatus ? [status, ''] : []));
    } else if (!inStatus) {
      lines.push(line);
    }
  }
  return lines.join('\n');
}

export const hasTaskSummary = ({ summary, lastDone, pending }: TaskNotes) => Boolean(summary || lastDone || pending);
