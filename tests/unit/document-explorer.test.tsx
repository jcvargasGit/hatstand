// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientFile } from '../../src/shared/api';
import { FileTree } from '../../src/renderer/src/components/FileTree';
import { buildFileTree } from '../../src/renderer/src/lib/file-tree';

const file = (folder: string, name: string): ClientFile => ({ path: `${folder}/${name}`, name, folder, scope: 'knowledge' });
const files = [file('/k', 'zeta.md'), file('/k', 'notes/plan.md'), file('/k', 'alpha.md')];

afterEach(cleanup);

describe('the file tree of a client', () => {
  it('groups files by folder, with folders first and names in order', () => {
    const [root] = buildFileTree(files, () => 'Knowledge');
    expect(root?.name).toBe('Knowledge');
    expect(root?.children.map((node) => node.name)).toEqual(['notes', 'alpha.md', 'zeta.md']);
    expect(root?.children[0]?.children[0]?.file?.path).toBe('/k/notes/plan.md');
  });

  it('shows the chosen file, marks what is not committed, and collapses folders', async () => {
    const onSelect = vi.fn();
    render(<FileTree nodes={buildFileTree(files)} selectedPath="/k/alpha.md" changedPaths={['/k/zeta.md']} onSelect={onSelect} />);

    await userEvent.click(screen.getByRole('button', { name: 'plan.md' }));
    expect(onSelect).toHaveBeenCalledWith(files[1]);
    expect(screen.getByRole('button', { name: 'alpha.md' }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByTitle('Not committed')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'notes' }));
    expect(screen.queryByRole('button', { name: 'plan.md' })).toBeNull();
  });
});
