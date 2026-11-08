import { useEffect, useRef, useState } from 'react';
import { CLIENT_COLORS } from '../lib/today';

type ColorFieldProps = {
  value: string;
  onChange: (color: string) => void;
};

const SETTLE_MS = 250;

const sameColor = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function ColorField({ value, onChange }: ColorFieldProps) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isCustom = !CLIENT_COLORS.some((item) => sameColor(item, draft));

  useEffect(() => setDraft(value), [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const pick = (color: string) => {
    clearTimeout(timer.current);
    setDraft(color);
    onChange(color);
  };

  const pickWhileDragging = (color: string) => {
    clearTimeout(timer.current);
    setDraft(color);
    timer.current = setTimeout(() => onChange(color), SETTLE_MS);
  };

  return (
    <fieldset className="swatches">
      <legend>Color</legend>
      {CLIENT_COLORS.map((item) => (
        <label key={item} className="swatch" style={{ background: item }}>
          <input type="radio" name="color" aria-label={`Color ${item}`} checked={sameColor(draft, item)} onChange={() => pick(item)} />
        </label>
      ))}
      <label className={`swatch swatch-custom${isCustom ? ' is-selected' : ''}`} style={isCustom ? { background: draft } : undefined} title="Choose any color">
        <input type="color" aria-label="Custom color" value={draft.toLowerCase()} onChange={(event) => pickWhileDragging(event.target.value)} />
      </label>
    </fieldset>
  );
}
