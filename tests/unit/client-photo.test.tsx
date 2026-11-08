// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientAvatar } from '../../src/renderer/src/components/ClientAvatar';
import { PhotoField } from '../../src/renderer/src/components/PhotoField';
import type { Bridge } from '../../src/shared/api';
import type { Company } from '../../src/shared/schemas';

const DATA_URL = 'data:image/png;base64,AAAA';
const invoke = vi.fn();

const company: Company = {
  id: 'acme',
  name: 'Acme Studio',
  color: '#112233',
  skipPermissions: false,
  origin: 'existing', hasCode: true, confirmedSteps: [],
  protectedPaths: [], links: [],
  subdomains: [],
  projects: [],
  context: {},
};
const withPhoto = (savedAt: string): Company => ({
  ...company,
  photo: { sourceUrl: 'https://acme.com/logo.png', type: 'image/png', savedAt },
});

beforeEach(() => {
  invoke.mockReset();
  window.hatstand = { invoke, on: () => () => {} } as unknown as Bridge;
});

afterEach(cleanup);

describe('ClientAvatar', () => {
  it('shows initials when the client has no photo', () => {
    render(<ClientAvatar company={company} />);
    expect(screen.getByText('AS')).toBeTruthy();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('shows the saved photo', async () => {
    invoke.mockResolvedValue(DATA_URL);
    const { container } = render(<ClientAvatar company={withPhoto('first')} />);
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe(DATA_URL));
  });

  it('goes back to initials when the photo cannot be shown', async () => {
    invoke.mockResolvedValue(DATA_URL);
    const { container } = render(<ClientAvatar company={withPhoto('broken')} />);
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(screen.getByText('AS')).toBeTruthy();
  });
});

describe('PhotoField', () => {
  it('saves the pasted link and clears the field', async () => {
    invoke.mockResolvedValue(undefined);
    const onChanged = vi.fn(async () => {});
    render(<PhotoField company={company} onChanged={onChanged} />);

    await userEvent.type(screen.getByLabelText('Photo link'), 'https://acme.com/logo.png');
    await userEvent.click(screen.getByRole('button', { name: 'Save photo' }));

    expect(invoke).toHaveBeenCalledWith('setClientPhoto', 'acme', 'https://acme.com/logo.png');
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(screen.getByLabelText<HTMLInputElement>('Photo link').value).toBe('');
  });

  it('shows why a link failed and keeps it to fix', async () => {
    invoke.mockRejectedValue(new Error('That link does not open a PNG, JPEG, WebP or GIF image.'));
    const onChanged = vi.fn(async () => {});
    render(<PhotoField company={company} onChanged={onChanged} />);

    await userEvent.type(screen.getByLabelText('Photo link'), 'https://acme.com/');
    await userEvent.click(screen.getByRole('button', { name: 'Save photo' }));

    expect(await screen.findByText(/does not open a PNG/)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Photo link').value).toBe('https://acme.com/');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('offers removal only when there is a photo', async () => {
    render(<PhotoField company={company} onChanged={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull();
    cleanup();

    invoke.mockResolvedValue(DATA_URL);
    render(<PhotoField company={withPhoto('removable')} onChanged={vi.fn(async () => {})} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    expect(invoke).toHaveBeenCalledWith('removeClientPhoto', 'acme');
  });
});
