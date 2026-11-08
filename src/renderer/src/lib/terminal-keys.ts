type KeyPress = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'>;

const COMMAND_KEYS: Record<string, string> = {
  ArrowLeft: '\x01',
  ArrowRight: '\x05',
  Backspace: '\x15',
};

export function terminalKeySequence({ key, shiftKey, metaKey, ctrlKey, altKey }: KeyPress): string | null {
  if (key === 'Enter' && shiftKey && !metaKey && !ctrlKey && !altKey) return '\x1b\r';
  if (metaKey && !shiftKey && !ctrlKey && !altKey) return COMMAND_KEYS[key] ?? null;
  return null;
}
