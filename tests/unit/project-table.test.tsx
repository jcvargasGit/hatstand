// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectTable } from '../../src/renderer/src/components/ProjectTable';
import type { Bridge } from '../../src/shared/api';
import type { Company } from '../../src/shared/schemas';

const invoke = vi.fn();

const company: Company = {
  id: 'acme',
  name: 'Acme',
  color: '#E8A33D',
  origin: 'existing',
  hasCode: true,
  confirmedSteps: [],
  skipPermissions: false,
  protectedPaths: [],
  links: [],
  subdomains: [
    { id: 'uploads', name: 'Uploads', description: '', links: [], folders: [] },
    { id: 'search', name: 'Search', description: '', links: [], folders: [] },
  ],
  projects: [
    { id: 'tools', name: 'tools', path: '/tools' },
    { id: 'search-api', name: 'search-api', path: '/search-api', subdomainId: 'search' },
    { id: 'uploads-web', name: 'uploads-web', path: '/uploads-web', subdomainId: 'uploads' },
    { id: 'uploads-api', name: 'uploads-api', path: '/uploads-api', subdomainId: 'uploads' },
  ],
  context: {},
};

/** The table as a person reads it: each group title with its count, then the repositories under it. */
const rows = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).queryByRole('columnheader')?.textContent ?? within(row).getAllByRole('cell')[0]?.textContent);

const renderTable = (shown: Company = company, onSave = vi.fn(async () => {})) => {
  const view = render(<ProjectTable company={shown} onSave={onSave} onChanged={vi.fn(async () => {})} />);
  return { ...view, onSave };
};

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async () => ({ tool: null, isMonorepo: false, folders: [] }));
  window.hatstand = { invoke, on: () => () => {} } as unknown as Bridge;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the repositories of a client', () => {
  it('are grouped by area, each group with how many it has', () => {
    renderTable();
    expect(rows()).toEqual(['Uploads2', 'uploads-web', 'uploads-api', 'Search1', 'search-api', 'No area1', 'tools']);
  });

  it('are filtered by name, without the groups left empty', async () => {
    renderTable();
    await userEvent.type(screen.getByLabelText('Filter the repositories of this client'), 'API');
    expect(rows()).toEqual(['Uploads1', 'uploads-api', 'Search1', 'search-api']);
  });

  it('say so when no repository matches the filter, and come back when it is cleared', async () => {
    renderTable();
    const filter = screen.getByLabelText('Filter the repositories of this client');
    await userEvent.type(filter, 'nothing-like-this');
    expect(screen.getByText('No repository matches this filter.')).toBeTruthy();
    expect(screen.queryByRole('row')).toBeNull();
    await userEvent.clear(filter);
    expect(screen.queryByText('No repository matches this filter.')).toBeNull();
    expect(rows()).toHaveLength(7);
  });

  it('move to the group of their new area', async () => {
    const { rerender, onSave } = renderTable();
    await userEvent.selectOptions(screen.getByLabelText('Area for tools'), 'Search');
    const [saved] = onSave.mock.lastCall as unknown as [Company];
    expect(saved.projects.find((project) => project.id === 'tools')?.subdomainId).toBe('search');

    rerender(<ProjectTable company={saved} onSave={onSave} onChanged={vi.fn(async () => {})} />);
    expect(rows()).toEqual(['Uploads2', 'uploads-web', 'uploads-api', 'Search2', 'tools', 'search-api']);
  });

  it('show nothing for a client with no repositories', () => {
    const { container } = renderTable({ ...company, projects: [] });
    expect(container.textContent).toBe('');
  });
});

describe('removing a repository from the list', () => {
  it('saves the client without it', async () => {
    const { onSave } = renderTable();
    await userEvent.click(within(screen.getByRole('row', { name: /^tools/ })).getByRole('button', { name: 'Remove' }));
    const [saved] = onSave.mock.lastCall as unknown as [Company];
    expect(saved.projects.map((project) => project.id)).toEqual(['search-api', 'uploads-web', 'uploads-api']);
  });

  it('shows the row leave before it saves, where the window can animate', async () => {
    const steps: string[] = [];
    let finishFade = () => {};
    Element.prototype.animate = vi.fn(function animate(this: Element) {
      steps.push(`fade ${this.getAttribute('data-motion-key')}`);
      return { finished: new Promise<void>((resolve) => (finishFade = resolve)), cancel: vi.fn() };
    }) as unknown as typeof Element.prototype.animate;
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    const onSave = vi.fn(async () => {
      steps.push('save');
    });
    renderTable(company, onSave);

    await userEvent.click(within(screen.getByRole('row', { name: /^tools/ })).getByRole('button', { name: 'Remove' }));
    expect(steps).toEqual(['fade tools']);
    finishFade();
    await vi.waitFor(() => expect(steps).toEqual(['fade tools', 'save']));

    delete (Element.prototype as { animate?: unknown }).animate;
    vi.unstubAllGlobals();
  });
});
