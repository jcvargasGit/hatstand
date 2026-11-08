import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { SearchReport, SearchResult, Snapshot } from '../../../shared/api';
import { api } from '../lib/api';
import { groupToday } from '../lib/today';

export type PaletteCommand = { id: string; title: string; hint?: string; run: () => void };

type CommandPaletteProps = {
  snapshot: Snapshot;
  commands: PaletteCommand[];
  onResult: (result: SearchResult) => void;
  onClose: () => void;
};

type Row = { id: string; group: string; title: string; detail?: string; snippet?: string; hint?: string; run: () => void };

const DEBOUNCE_MS = 150;
const EMPTY_REPORT: SearchReport = { results: [], partial: false };
const GROUP: Record<SearchResult['kind'], string> = { client: 'Clients', task: 'Tasks', repo: 'Repositories', file: 'Documents' };
const plain = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const resultId = (result: SearchResult) => `${result.kind}-${result.kind === 'task' ? result.taskId : (result.path ?? result.companyId)}`;

export function CommandPalette({ snapshot, commands, onResult, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [report, setReport] = useState<SearchReport>(EMPTY_REPORT);
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    input.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setReport(EMPTY_REPORT);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void api
        .searchEverything(text)
        .catch(() => EMPTY_REPORT)
        .then((found) => {
          if (active) setReport(found ?? EMPTY_REPORT);
        });
    }, DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const rows = useMemo<Row[]>(() => {
    const words = plain(query).split(/\s+/).filter(Boolean);
    const commandRows = commands
      .filter((command) => words.every((word) => plain(command.title).includes(word)))
      .map((command): Row => ({ id: command.id, group: 'Actions', title: command.title, hint: command.hint, run: command.run }));
    if (words.length === 0) {
      const waiting = groupToday(snapshot, null).waiting.map(
        (item): Row => ({
          id: `waiting-${item.task.id}`,
          group: 'Waiting for you',
          title: item.task.title,
          detail: item.company.name,
          run: () => onResult({ kind: 'task', taskId: item.task.id, companyId: item.company.id, title: item.task.title, client: item.company.name }),
        }),
      );
      return [...waiting, ...commandRows];
    }
    const found = report.results.map(
      (result): Row => ({
        id: resultId(result),
        group: GROUP[result.kind],
        title: result.title,
        detail: result.client,
        snippet: result.snippet,
        run: () => onResult(result),
      }),
    );
    return [...found, ...commandRows];
  }, [commands, onResult, query, report, snapshot]);

  useEffect(() => setSelected(0), [query, report]);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const choose = (row: Row | undefined) => {
    if (!row) return;
    onClose();
    row.run();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') onClose();
    else if (event.key === 'Enter') choose(rows[selected]);
    else if (event.key === 'ArrowDown') setSelected((current) => Math.min(current + 1, rows.length - 1));
    else if (event.key === 'ArrowUp') setSelected((current) => Math.max(current - 1, 0));
    else return;
    event.preventDefault();
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search everything" onMouseDown={(event) => event.stopPropagation()}>
        <label className="palette-input">
          <Search size={17} />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={rows[selected] ? `palette-${selected}` : undefined}
            aria-label="Search everything"
            placeholder="Search tasks, clients, repositories and documents"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </label>
        <ul id="palette-results" ref={list} role="listbox" className="palette-results">
          {rows.map((row, index) => (
            <li key={row.id} role="presentation">
              {rows[index - 1]?.group !== row.group && <p className="palette-group">{row.group}</p>}
              <button id={`palette-${index}`} role="option" aria-selected={index === selected} tabIndex={-1} onMouseMove={() => setSelected(index)} onClick={() => choose(row)}>
                <span className="palette-title">{row.title}</span>
                {row.detail && <small>{row.detail}</small>}
                {row.hint && <kbd>{row.hint}</kbd>}
                {row.snippet && <span className="palette-snippet">{row.snippet}</span>}
              </button>
            </li>
          ))}
        </ul>
        {query.trim().length >= 2 && rows.length === 0 && <p className="palette-empty">Nothing matches “{query.trim()}”.</p>}
        {report.partial && <p className="palette-empty">Stopped reading files early. Add a word to narrow this down.</p>}
      </div>
    </div>
  );
}
