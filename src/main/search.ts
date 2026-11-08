import { readFile, stat } from 'node:fs/promises';
import type { ClientFile, SearchReport, SearchResult } from '../shared/api';
import type { Company, Task } from '../shared/schemas';

const MAX_PER_KIND = 8;
const MAX_CONTENT_HITS = 12;
const MAX_CONTENT_BYTES = 256 * 1024;
const SNIPPET_RADIUS = 60;
const DEFAULT_BUDGET_MS = 1500;

type SearchSources = {
  companies: Company[];
  tasks: Task[];
  readNotes: (task: Task) => string;
  listFiles: (company: Company) => ClientFile[];
  budgetMs?: number;
};

const normalize = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const terms = (query: string) => normalize(query).split(/\s+/).filter(Boolean);
const matchesAll = (text: string, words: string[]) => {
  const plain = normalize(text);
  return words.every((word) => plain.includes(word));
};

export function snippet(text: string, words: string[]): string | undefined {
  const plain = normalize(text);
  const at = Math.min(...words.map((word) => plain.indexOf(word)).filter((index) => index >= 0));
  if (!Number.isFinite(at)) return undefined;
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const part = text.slice(start, at + SNIPPET_RADIUS).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${part}${at + SNIPPET_RADIUS < text.length ? '…' : ''}`;
}

export async function searchWorkspace(query: string, sources: SearchSources): Promise<SearchReport> {
  const words = terms(query);
  if (words.join('').length < 2) return { results: [], partial: false };
  const companies = sources.companies.filter((company) => !company.archivedAt);
  const clientName = new Map(companies.map((company) => [company.id, company.name]));
  const tasks = sources.tasks.filter((task) => clientName.has(task.companyId));

  const clients = companies
    .filter((company) => matchesAll(company.name, words))
    .map((company): SearchResult => ({ kind: 'client', companyId: company.id, title: company.name, client: company.name }));
  const taskResult = (task: Task, detail?: string): SearchResult => ({
    kind: 'task',
    taskId: task.id,
    companyId: task.companyId,
    title: task.title,
    client: clientName.get(task.companyId) ?? '',
    snippet: detail,
  });
  const titled = tasks.filter((task) => matchesAll(`${task.title} ${task.source?.key ?? ''} ${task.number ? `#${task.number}` : ''}`, words));
  const described = tasks
    .filter((task) => !titled.includes(task))
    .flatMap((task) => {
      const body = `${task.description}\n${sources.readNotes(task)}`;
      return matchesAll(body, words) ? [taskResult(task, snippet(body, words))] : [];
    });
  const repos = companies.flatMap((company) =>
    [...company.projects, ...(company.planning ? [{ name: 'Planning repository', path: company.planning.path }] : [])]
      .filter((project) => matchesAll(`${project.name} ${project.path}`, words))
      .map((project): SearchResult => ({ kind: 'repo', companyId: company.id, title: project.name, client: company.name, path: project.path })),
  );

  const named: SearchResult[] = [];
  const contents: SearchResult[] = [];
  const deadline = Date.now() + (sources.budgetMs ?? DEFAULT_BUDGET_MS);
  let partial = false;
  const files = companies.flatMap((company) => sources.listFiles(company).map((file) => ({ file, company })));
  for (const { file, company } of files) {
    const fileResult = (detail?: string): SearchResult => ({
      kind: 'file',
      companyId: company.id,
      title: file.name,
      client: company.name,
      path: file.path,
      scope: file.scope,
      snippet: detail,
    });
    if (matchesAll(file.name, words)) {
      named.push(fileResult());
      continue;
    }
    if (contents.length >= MAX_CONTENT_HITS) continue;
    if (Date.now() > deadline) {
      partial = true;
      continue;
    }
    try {
      if ((await stat(file.path)).size > MAX_CONTENT_BYTES) continue;
      const content = await readFile(file.path, 'utf8');
      if (matchesAll(content, words)) contents.push(fileResult(snippet(content, words)));
    } catch {
      continue;
    }
  }

  return {
    partial,
    results: [
      ...clients.slice(0, MAX_PER_KIND),
      ...titled.slice(0, MAX_PER_KIND).map((task) => taskResult(task)),
      ...repos.slice(0, MAX_PER_KIND),
      ...named.slice(0, MAX_PER_KIND),
      ...described.slice(0, MAX_PER_KIND),
      ...contents,
    ],
  };
}
