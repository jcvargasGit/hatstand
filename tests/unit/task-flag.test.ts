import { describe, expect, it } from 'vitest';
import { flagFrom, menuPlace } from '../../src/renderer/src/lib/task-flag';
import { cleanFlags, DEFAULT_FLAGS, flagLabel, MAX_FLAGS, withFlag } from '../../src/shared/task-flags';
import { taskFlagSchema } from '../../src/shared/schemas';

describe('the flag of a task', () => {
  it('offers the red flag first, and only choices the task can store', () => {
    const emojis = DEFAULT_FLAGS.map((flag) => flag.emoji);
    expect(emojis[0]).toBe('🚩');
    expect(new Set(emojis).size).toBe(emojis.length);
    DEFAULT_FLAGS.forEach((flag) => {
      expect(taskFlagSchema.parse(flag.emoji)).toBe(flag.emoji);
      expect(flagFrom(flag.emoji)).toBe(flag.emoji);
      expect(flag.name).not.toBe('');
    });
  });

  it('keeps the first emoji of what a person types', () => {
    expect(flagFrom('🔥 urgent')).toBe('🔥');
    expect(flagFrom('  🎯🎯')).toBe('🎯');
  });

  it('keeps an emoji made of several parts whole', () => {
    expect(flagFrom('👨‍💻 pairing')).toBe('👨‍💻');
    expect(flagFrom('⚠️!')).toBe('⚠️');
    expect(flagFrom('👍🏽')).toBe('👍🏽');
    expect(taskFlagSchema.parse(flagFrom('👨‍👩‍👧‍👦'))).toBe('👨‍👩‍👧‍👦');
  });

  it('is empty when nothing was typed', () => {
    expect(flagFrom('')).toBe('');
    expect(flagFrom('   ')).toBe('');
  });
});

describe('placing the menu of a task', () => {
  const menu = { width: 200, height: 100 };
  const viewport = { width: 800, height: 600 };

  it('opens where the click was when it fits', () => {
    expect(menuPlace({ x: 40, y: 50 }, menu, viewport)).toEqual({ x: 40, y: 50 });
  });

  it('stays inside the window near its right and bottom edges', () => {
    expect(menuPlace({ x: 790, y: 590 }, menu, viewport)).toEqual({ x: 592, y: 492 });
  });

  it('stays inside the window near its left and top edges', () => {
    expect(menuPlace({ x: 0, y: -5 }, menu, viewport)).toEqual({ x: 8, y: 8 });
  });
});

describe('the list of flags a person keeps', () => {
  it('adds an emoji the person typed, once, without a name', () => {
    const added = withFlag(DEFAULT_FLAGS, '🎯');
    expect(added.at(-1)).toEqual({ emoji: '🎯', name: '' });
    expect(withFlag(added, '🎯')).toBe(added);
    expect(withFlag(DEFAULT_FLAGS, '')).toBe(DEFAULT_FLAGS);
  });

  it('adds nothing once the menu is full', () => {
    const full = Array.from({ length: MAX_FLAGS }, (_item, index) => ({ emoji: `e${index}`, name: '' }));
    expect(withFlag(full, '🎯')).toBe(full);
  });

  it('saves each emoji once, without empty ones, and no more than the menu holds', () => {
    expect(cleanFlags([{ emoji: ' 🎯 ', name: ' Goal ' }, { emoji: '🎯', name: 'Again' }, { emoji: '  ', name: 'Empty' }])).toEqual([{ emoji: '🎯', name: 'Goal' }]);
    expect(cleanFlags(Array.from({ length: MAX_FLAGS + 3 }, (_item, index) => ({ emoji: `e${index}`, name: '' })))).toHaveLength(MAX_FLAGS);
  });

  it('names a flag by its emoji and its name, or by the emoji alone', () => {
    expect(flagLabel({ emoji: '🎯', name: 'Goal' })).toBe('🎯 Goal');
    expect(flagLabel({ emoji: '🎯', name: '' })).toBe('🎯');
  });
});
