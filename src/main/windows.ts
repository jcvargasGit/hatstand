import type { BrowserWindowConstructorOptions } from 'electron';

export type WindowKind = 'main' | 'new-task';

type WindowSetup = {
  kind: WindowKind;
  title: string;
  preload: string;
  /** Tests and agents run Hatstand with no window on screen. */
  headless: boolean;
  dark: boolean;
};

const SIZES: Record<WindowKind, { width: number; height: number }> = {
  main: { width: 1440, height: 900 },
  'new-task': { width: 1100, height: 780 },
};

/** The options of every Hatstand window. A headless run never shows one, whichever kind it is. */
export function windowOptions({ kind, title, preload, headless, dark }: WindowSetup): BrowserWindowConstructorOptions {
  return {
    ...SIZES[kind],
    minWidth: 760,
    minHeight: 520,
    title,
    show: !headless,
    backgroundColor: dark ? '#1c1f26' : '#f6f7f9',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !headless,
    },
  };
}

/** The query that tells the page which window it is in. */
export const newTaskWindowQuery = (draftId: string): Record<string, string> => ({ 'new-task': draftId });
