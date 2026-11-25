const LINE_SUFFIX = /:\d+(:\d+)?$/;
const SENTENCE_END = /[.,;:]+$/;

/**
 * The file a link or a piece of inline code points to, when it is an absolute path on this computer.
 * A line number after the path and the dot that ends a sentence are left out. Null for anything else, such as a web link.
 */
export function pathFromLink(text: string | undefined): string | null {
  const trimmed = (text ?? '').trim();
  const raw = trimmed.startsWith('file://') ? decodePath(trimmed.slice('file://'.length)) : trimmed;
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || /\s{2,}|\n/.test(raw)) return null;
  const path = raw.replace(SENTENCE_END, '').replace(LINE_SUFFIX, '');
  return path.split('/').filter(Boolean).length >= 2 ? path : null;
}

function decodePath(path: string): string | null {
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}
