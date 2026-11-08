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
