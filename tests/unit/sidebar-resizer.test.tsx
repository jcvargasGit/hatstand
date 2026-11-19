// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarResizer } from '../../src/renderer/src/components/SidebarResizer';

afterEach(cleanup);

/** jsdom has no pointer events, so a mouse event with the same name stands in for one. */
const pointer = (edge: HTMLElement, type: string, clientX: number) => fireEvent(edge, new MouseEvent(type, { bubbles: true, button: 0, clientX }));

const renderResizer = (width = 276) => {
  const props = { width, onResize: vi.fn(), onReset: vi.fn() };
  render(<SidebarResizer {...props} />);
  return { ...props, edge: screen.getByRole('separator', { name: 'Resize sidebar' }) };
};

describe('the edge that resizes the sidebar', () => {
  it('says how wide the sidebar is and how wide it can be', () => {
    const { edge } = renderResizer(300);
    expect(edge.getAttribute('aria-valuenow')).toBe('300');
    expect(edge.getAttribute('aria-valuemin')).toBe('220');
    expect(edge.getAttribute('aria-valuemax')).toBe('480');
    expect(edge.tabIndex).toBe(0);
  });

  it('follows the pointer while it is dragged', () => {
    const { edge, onResize } = renderResizer(276);
    pointer(edge, 'pointerdown', 276);
    pointer(edge, 'pointerup', 336);
    expect(onResize).toHaveBeenLastCalledWith(336);
  });

  it('stops at the widest and the narrowest it can be', () => {
    const { edge, onResize } = renderResizer(276);
    pointer(edge, 'pointerdown', 276);
    pointer(edge, 'pointerup', 2000);
    expect(onResize).toHaveBeenLastCalledWith(480);
    pointer(edge, 'pointerdown', 276);
    pointer(edge, 'pointerup', 0);
    expect(onResize).toHaveBeenLastCalledWith(220);
  });

  it('does nothing when the pointer moves without a drag', () => {
    const { edge, onResize } = renderResizer();
    pointer(edge, 'pointermove', 400);
    pointer(edge, 'pointerup', 400);
    expect(onResize).not.toHaveBeenCalled();
  });

  it('moves with the arrow keys, and jumps to each end with Home and End', () => {
    const { edge, onResize } = renderResizer(276);
    fireEvent.keyDown(edge, { key: 'ArrowRight' });
    expect(onResize).toHaveBeenLastCalledWith(292);
    fireEvent.keyDown(edge, { key: 'ArrowLeft' });
    expect(onResize).toHaveBeenLastCalledWith(260);
    fireEvent.keyDown(edge, { key: 'Home' });
    expect(onResize).toHaveBeenLastCalledWith(220);
    fireEvent.keyDown(edge, { key: 'End' });
    expect(onResize).toHaveBeenLastCalledWith(480);
    fireEvent.keyDown(edge, { key: 'a' });
    expect(onResize).toHaveBeenCalledTimes(4);
  });

  it('goes back to the usual width on a double click', () => {
    const { edge, onReset } = renderResizer(400);
    fireEvent.doubleClick(edge);
    expect(onReset).toHaveBeenCalled();
  });
});
