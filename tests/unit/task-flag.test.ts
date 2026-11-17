import { describe, expect, it } from 'vitest';
import { FLAG_CHOICES, flagFrom, menuPlace } from '../../src/renderer/src/lib/task-flag';
import { taskFlagSchema } from '../../src/shared/schemas';

describe('the flag of a task', () => {
  it('offers the red flag first, and only choices the task can store', () => {
    expect(FLAG_CHOICES[0]).toBe('🚩');
    expect(new Set(FLAG_CHOICES).size).toBe(FLAG_CHOICES.length);
    FLAG_CHOICES.forEach((flag) => {
      expect(taskFlagSchema.parse(flag)).toBe(flag);
      expect(flagFrom(flag)).toBe(flag);
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
