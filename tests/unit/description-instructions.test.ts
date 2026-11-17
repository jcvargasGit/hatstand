import { describe, expect, it } from 'vitest';
import { areaDescriptionPrompt, DEFAULT_DESCRIPTION_INSTRUCTIONS, descriptionInstructionsFor } from '../../src/shared/description-instructions';
import { subdomainSchema } from '../../src/shared/schemas';

describe('the prompt an area starts with', () => {
  it('is the default with no area, or an area with no prompt', () => {
    expect(descriptionInstructionsFor()).toBe(DEFAULT_DESCRIPTION_INSTRUCTIONS);
    expect(descriptionInstructionsFor({})).toBe(DEFAULT_DESCRIPTION_INSTRUCTIONS);
    expect(descriptionInstructionsFor({ descriptionPrompt: ' \n' })).toBe(DEFAULT_DESCRIPTION_INSTRUCTIONS);
  });

  it('is the prompt of the area when it has one', () => {
    expect(descriptionInstructionsFor({ descriptionPrompt: 'Name the tables.' })).toBe('Name the tables.');
  });

  it('is stored only when it differs from the default', () => {
    expect(areaDescriptionPrompt('')).toBeUndefined();
    expect(areaDescriptionPrompt('  \n')).toBeUndefined();
    expect(areaDescriptionPrompt(`${DEFAULT_DESCRIPTION_INSTRUCTIONS}\n`)).toBeUndefined();
    expect(areaDescriptionPrompt('Name the tables.')).toBe('Name the tables.');
  });

  it('is optional in the data of an area, so older clients still load', () => {
    expect(subdomainSchema.parse({ id: 'b', name: 'Billing' }).descriptionPrompt).toBeUndefined();
    expect(subdomainSchema.parse({ id: 'b', name: 'Billing', descriptionPrompt: 'Name the tables.' }).descriptionPrompt).toBe('Name the tables.');
  });
});
