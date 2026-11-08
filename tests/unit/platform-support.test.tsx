// @vitest-environment jsdom
import { fireEvent, renderHook } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canInstallRelease } from '../../src/main/release';
import { canEncryptSafely } from '../../src/main/secrets';
import { useSidebarLayout } from '../../src/renderer/src/hooks/useSidebarLayout';
import { shortcutKey, shortcutLabel, submitShortcutLabel } from '../../src/renderer/src/lib/shortcuts';

describe('saving keys', () => {
  it.each(['basic_text', 'unknown', undefined])('refuses the %s backend on Linux', (linuxBackend) => {
    expect(canEncryptSafely({ platform: 'linux', encryptionAvailable: true, linuxBackend })).toBe(false);
  });

  it.each(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'])('accepts the %s backend on Linux', (linuxBackend) => {
    expect(canEncryptSafely({ platform: 'linux', encryptionAvailable: true, linuxBackend })).toBe(true);
  });

  it('accepts macOS when the keychain is available', () => {
    expect(canEncryptSafely({ platform: 'darwin', encryptionAvailable: true })).toBe(true);
  });

  it.each(['darwin', 'linux'] as const)('refuses %s when encryption is not available', (platform) => {
    expect(canEncryptSafely({ platform, encryptionAvailable: false, linuxBackend: 'gnome_libsecret' })).toBe(false);
  });
});

describe('updating the installed app', () => {
  it('is offered in the development copy on macOS', () => {
    expect(canInstallRelease({ platform: 'darwin', isDevCopy: true, isPackaged: false })).toBe(true);
  });

  it('is not offered on Linux, where the installer does not run', () => {
    expect(canInstallRelease({ platform: 'linux', isDevCopy: true, isPackaged: false })).toBe(false);
  });

  it.each([
    { isDevCopy: false, isPackaged: false },
    { isDevCopy: true, isPackaged: true },
  ])('is not offered outside the development copy: %o', (context) => {
    expect(canInstallRelease({ platform: 'darwin', ...context })).toBe(false);
  });
});

describe('keyboard shortcuts', () => {
  const pretendPlatform = (platform: string) => vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('labels shortcuts for macOS', () => {
    pretendPlatform('MacIntel');
    expect(shortcutLabel('K')).toBe('⌘K');
    expect(submitShortcutLabel()).toBe('⌘ Enter');
  });

  it('labels shortcuts for Linux', () => {
    pretendPlatform('Linux x86_64');
    expect(shortcutLabel('K')).toBe('Ctrl+Shift+K');
    expect(submitShortcutLabel()).toBe('Ctrl+Enter');
  });

  it.each([
    { key: '!', code: 'Digit1', shiftKey: true, expected: '1' },
    { key: '<', code: 'Comma', shiftKey: true, expected: ',' },
    { key: 'K', code: 'KeyK', shiftKey: true, expected: 'k' },
    { key: '1', code: 'Digit1', shiftKey: false, expected: '1' },
    { key: ',', code: 'Comma', shiftKey: false, expected: ',' },
    { key: 'Enter', code: 'Enter', shiftKey: true, expected: 'enter' },
  ])('reads $code with shift $shiftKey as $expected', ({ expected, ...event }) => {
    expect(shortcutKey(event)).toBe(expected);
  });

  it('hides the sidebar with Command+B on macOS', () => {
    pretendPlatform('MacIntel');
    const { result } = renderHook(() => useSidebarLayout());
    act(() => {
      fireEvent.keyDown(window, { key: 'b', metaKey: true });
    });
    expect(result.current.collapsed).toBe(true);
  });

  it('hides the sidebar with Ctrl+Shift+B on Linux', () => {
    pretendPlatform('Linux x86_64');
    const { result } = renderHook(() => useSidebarLayout());
    act(() => {
      fireEvent.keyDown(window, { key: 'B', ctrlKey: true, shiftKey: true });
    });
    expect(result.current.collapsed).toBe(true);
  });

  it('leaves Ctrl+B for the terminal on Linux', () => {
    pretendPlatform('Linux x86_64');
    const { result } = renderHook(() => useSidebarLayout());
    act(() => {
      fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    });
    expect(result.current.collapsed).toBe(false);
  });
});
