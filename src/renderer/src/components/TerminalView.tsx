import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { terminalKeySequence } from '../lib/terminal-keys';
import { newerThan } from '../lib/terminal-output';
import { wheelSensitivity } from '../lib/terminal-scroll';

export function TerminalView({ sessionId, focusRequest = 0 }: { sessionId: string; focusRequest?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<Terminal | null>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const client = getComputedStyle(element).getPropertyValue('--client').trim();
    const terminal = new Terminal({
      fontFamily: '"JetBrains Mono Variable", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
      theme: { background: '#14181f', foreground: '#eceef2', cursor: client, selectionBackground: '#3a4a60' },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = '11';
    terminal.loadAddon(new WebLinksAddon((_event, url) => void api.openLink(url)));
    terminal.attachCustomKeyEventHandler((event) => {
      const sequence = terminalKeySequence(event);
      if (sequence === null) return true;
      event.preventDefault();
      if (event.type === 'keydown') void api.writeSession(sessionId, sequence);
      return false;
    });
    terminal.open(element);
    instance.current = terminal;

    const matchWheelSpeed = (event: WheelEvent) => {
      const appReceivesWheel = terminal.modes.mouseTrackingMode !== 'none' || terminal.buffer.active.type === 'alternate';
      const sensitivity = wheelSensitivity(event.deltaY, appReceivesWheel);
      if (terminal.options.scrollSensitivity !== sensitivity) terminal.options.scrollSensitivity = sensitivity;
    };
    element.addEventListener('wheel', matchWheelSpeed, { capture: true, passive: true });

    // Output that arrives before the buffer does is already in it, so writing it again would show it twice.
    let attached = false;
    const pending: { data: string; end: number }[] = [];
    const stopData = window.hatstand.on('session-data', (event) => {
      if (event.sessionId !== sessionId) return;
      if (attached) terminal.write(event.data);
      else pending.push(event);
    });
    const input = terminal.onData((data) => void api.writeSession(sessionId, data));
    void api.readSessionOutput(sessionId).then((output) => {
      terminal.write(output.text);
      newerThan(pending, output.end).forEach((chunk) => terminal.write(chunk.data));
      attached = true;
    });

    const resize = () => {
      fit.fit();
      void api.resizeSession(sessionId, terminal.cols, terminal.rows);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    terminal.focus();

    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', matchWheelSpeed, { capture: true });
      input.dispose();
      stopData();
      instance.current = null;
      terminal.dispose();
    };
  }, [sessionId]);

  useEffect(() => {
    if (focusRequest > 0) instance.current?.focus();
  }, [focusRequest]);

  return <div className="terminal-host" ref={host} data-testid="terminal" />;
}
