// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bridge, SessionOutput } from '../../src/shared/api';
import { newerThan } from '../../src/renderer/src/lib/terminal-output';

const written = vi.hoisted(() => [] as string[]);

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options = {};
    modes = { mouseTrackingMode: 'none' };
    buffer = { active: { type: 'normal' } };
    unicode = { activeVersion: '' };
    loadAddon() {}
    attachCustomKeyEventHandler() {}
    open() {}
    focus() {}
    dispose() {}
    onData() {
      return { dispose() {} };
    }
    write(data: string) {
      written.push(data);
    }
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));

const { TerminalView } = await import('../../src/renderer/src/components/TerminalView');

let send: (event: { sessionId: string; data: string; end: number }) => void;
let finishRead: (output: SessionOutput) => void;

beforeEach(() => {
  written.length = 0;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  window.hatstand = {
    invoke: vi.fn((method: string) => (method === 'readSessionOutput' ? new Promise<SessionOutput>((resolve) => (finishRead = resolve)) : Promise.resolve(undefined))),
    on: (_event: string, listener: typeof send) => {
      send = listener;
      return () => {};
    },
  } as unknown as Bridge;
});

afterEach(cleanup);

describe('opening the terminal of a running session', () => {
  it('shows output that arrives while it reads the earlier output once, and keeps what comes after', async () => {
    render(<TerminalView sessionId="s1" />);
    send({ sessionId: 's1', data: 'fake claude is ready\r\n', end: 22 });
    send({ sessionId: 's1', data: 'heard: x', end: 30 });
    await act(async () => finishRead({ text: 'fake claude is ready\r\n', end: 22 }));
    send({ sessionId: 's1', data: '!', end: 31 });
    send({ sessionId: 'other', data: 'not mine', end: 8 });
    expect(written.join('')).toBe('fake claude is ready\r\nheard: x!');
  });

  it('keeps only the chunks that end after the read', () => {
    expect(newerThan([{ end: 5 }, { end: 9 }, { end: 12 }], 9)).toEqual([{ end: 12 }]);
  });
});
