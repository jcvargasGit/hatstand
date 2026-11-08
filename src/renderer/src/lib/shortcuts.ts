const isMac = () => /mac/i.test(navigator.platform);

export const isCommandKey = (event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>) => (isMac() ? event.metaKey : event.ctrlKey && event.shiftKey);

// Holding Shift turns 1 into ! and the comma into <, so these shortcuts read the physical key instead.
export const shortcutKey = ({ key, code, shiftKey }: Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey'>) => {
  if (shiftKey && /^Digit\d$/.test(code)) return code.slice('Digit'.length);
  if (shiftKey && code === 'Comma') return ',';
  return key.toLowerCase();
};

export const shortcutLabel =(key: string) => (isMac() ? `⌘${key}` : `Ctrl+Shift+${key}`);

export const submitShortcutLabel = () => (isMac() ? '⌘ Enter' : 'Ctrl+Enter');
