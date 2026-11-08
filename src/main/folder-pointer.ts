const START = '<!-- hatstand:active-folder -->';
const END = '<!-- /hatstand:active-folder -->';
const BLOCK = new RegExp(`${START}[\\s\\S]*?${END}\\s*`);

export function withFolderPointer(text: string, activeFolder: string | undefined): string {
  const hasBlock = BLOCK.test(text);
  if (!activeFolder && !hasBlock) return text;
  const rest = text.replace(BLOCK, '').trim();
  if (!activeFolder) return rest ? `${rest}\n` : '';
  const block = `${START}\n> Hatstand does not use this folder for this client right now. The folder in use is ${activeFolder}\n${END}`;
  return rest ? `${block}\n\n${rest}\n` : `${block}\n`;
}
