// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AreaDescriptionPrompt } from '../../src/renderer/src/components/AreaDescriptionPrompt';
import { DEFAULT_DESCRIPTION_INSTRUCTIONS } from '../../src/shared/description-instructions';
import { subdomainSchema } from '../../src/shared/schemas';

vi.mock('../../src/renderer/src/components/MarkdownField', () => ({
  MarkdownField: ({ label, value, onChange, onCommit }: { label: string; value: string; onChange: (value: string) => void; onCommit?: (value: string) => void }) => (
    <textarea aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} onBlur={(event) => onCommit?.(event.target.value)} />
  ),
}));

afterEach(cleanup);

const area = (descriptionPrompt?: string) => subdomainSchema.parse({ id: 'b', name: 'Billing', descriptionPrompt });
const field = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Prompt to improve descriptions' });

describe('the prompt of an area to improve descriptions', () => {
  it('shows the default when the area has no prompt of its own', () => {
    render(<AreaDescriptionPrompt area={area()} onSave={() => {}} />);
    expect(field().value).toBe(DEFAULT_DESCRIPTION_INSTRUCTIONS);
    expect(screen.getByText(/This area uses the default prompt/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use the default' })).toHaveProperty('disabled', true);
  });

  it('saves a changed prompt in the area', async () => {
    const onSave = vi.fn();
    render(<AreaDescriptionPrompt area={area()} onSave={onSave} />);
    await userEvent.clear(field());
    await userEvent.type(field(), 'Name the invoice tables.');
    await userEvent.tab();
    expect(onSave).toHaveBeenCalledExactlyOnceWith('Name the invoice tables.');
  });

  it('saves nothing when the text is left as the default', async () => {
    const onSave = vi.fn();
    render(<AreaDescriptionPrompt area={area()} onSave={onSave} />);
    await userEvent.click(field());
    await userEvent.tab();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('goes back to the default when the prompt is emptied', async () => {
    const onSave = vi.fn();
    render(<AreaDescriptionPrompt area={area('Name the invoice tables.')} onSave={onSave} />);
    expect(screen.getByText(/This area has its own prompt/)).toBeTruthy();
    await userEvent.clear(field());
    await userEvent.tab();
    expect(onSave).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(field().value).toBe(DEFAULT_DESCRIPTION_INSTRUCTIONS);
  });

  it('removes the prompt of the area with "Use the default"', async () => {
    const onSave = vi.fn();
    render(<AreaDescriptionPrompt area={area('Name the invoice tables.')} onSave={onSave} />);
    expect(field().value).toBe('Name the invoice tables.');
    await userEvent.click(screen.getByRole('button', { name: 'Use the default' }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(field().value).toBe(DEFAULT_DESCRIPTION_INSTRUCTIONS);
  });
});
