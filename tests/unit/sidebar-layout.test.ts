// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSidebarLayout } from '../../src/renderer/src/hooks/useSidebarLayout';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('hiding the Needs you list', () => {
  it('starts visible, also with what older versions saved', () => {
    localStorage.setItem('hatstand.sidebar', JSON.stringify({ collapsed: false, closedClients: ['acme'] }));
    const { result } = renderHook(() => useSidebarLayout());
    expect(result.current.needsYouHidden).toBe(false);
    expect(result.current.closedClients).toEqual(['acme']);
  });

  it('remembers the choice the next time the app opens', () => {
    const first = renderHook(() => useSidebarLayout());
    act(() => first.result.current.toggleNeedsYou());
    expect(first.result.current.needsYouHidden).toBe(true);
    first.unmount();
    const second = renderHook(() => useSidebarLayout());
    expect(second.result.current.needsYouHidden).toBe(true);
    act(() => second.result.current.toggleNeedsYou());
    expect(second.result.current.needsYouHidden).toBe(false);
  });
});

describe('the width of the sidebar', () => {
  it('starts at the usual width, also with what older versions saved', () => {
    localStorage.setItem('hatstand.sidebar', JSON.stringify({ collapsed: false, closedClients: ['acme'] }));
    const { result } = renderHook(() => useSidebarLayout());
    expect(result.current.width).toBe(276);
  });

  it('remembers the width the next time the app opens', () => {
    const first = renderHook(() => useSidebarLayout());
    act(() => first.result.current.setWidth(340));
    expect(first.result.current.width).toBe(340);
    first.unmount();
    expect(renderHook(() => useSidebarLayout()).result.current.width).toBe(340);
  });

  it('stays between the narrowest and the widest it can be', () => {
    const { result } = renderHook(() => useSidebarLayout());
    act(() => result.current.setWidth(40));
    expect(result.current.width).toBe(220);
    act(() => result.current.setWidth(4000));
    expect(result.current.width).toBe(480);
  });

  it('ignores a saved width that is not a number or is out of range', () => {
    localStorage.setItem('hatstand.sidebar', JSON.stringify({ width: 'wide' }));
    expect(renderHook(() => useSidebarLayout()).result.current.width).toBe(276);
    localStorage.setItem('hatstand.sidebar', JSON.stringify({ width: 9000 }));
    expect(renderHook(() => useSidebarLayout()).result.current.width).toBe(480);
  });

  it('goes back to the usual width', () => {
    const { result } = renderHook(() => useSidebarLayout());
    act(() => result.current.setWidth(400));
    act(() => result.current.resetWidth());
    expect(result.current.width).toBe(276);
  });
});
