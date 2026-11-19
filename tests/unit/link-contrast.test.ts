import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast } from '../../src/renderer/src/lib/today';

const styles = readFileSync(join(__dirname, '../../src/renderer/src/styles.css'), 'utf8');
const lightBlock = styles.slice(styles.indexOf(':root {'), styles.indexOf('@media (prefers-color-scheme: dark)'));
const darkStart = styles.indexOf('@media (prefers-color-scheme: dark)');
const darkBlock = styles.slice(darkStart, styles.indexOf('}\n}', darkStart));

function token(block: string, name: string): string {
  const value = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`).exec(block)?.[1];
  if (!value) throw new Error(`No color for --${name}`);
  return value;
}

const READABLE = 4.5;
const BACKGROUNDS = ['surface', 'bg', 'sidebar'];

describe('the color of links', () => {
  it.each(BACKGROUNDS)('can be read on --%s in the light theme', (background) => {
    expect(contrast(token(lightBlock, 'link'), token(lightBlock, background))).toBeGreaterThanOrEqual(READABLE);
  });

  it.each(BACKGROUNDS)('can be read on --%s in the dark theme', (background) => {
    expect(contrast(token(darkBlock, 'link'), token(darkBlock, background))).toBeGreaterThanOrEqual(READABLE);
  });

  it('is what links use, when reading and when editing', () => {
    expect(styles).toMatch(/\na \{\n\s*color: var\(--link\);/);
    expect(styles).toMatch(/\.cm-md-link \{\n\s*color: var\(--link\);/);
  });

  it('would fail the color CodeMirror uses by default on a dark background', () => {
    expect(contrast('#221199', token(darkBlock, 'surface'))).toBeLessThan(READABLE);
  });
});
