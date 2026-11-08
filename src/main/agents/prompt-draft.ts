const TOKENS = /\x1b\[200~(?<pasted>[\s\S]*?)\x1b\[201~|(?<newline>\x1b\r)|(?<recall>\x1b\[A|\x1bOA)|(?<escape>\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1bO[ -~]|\x1b[ -~]?)|(?<char>[\s\S])/gu;
const CLEARS_THE_BOX = new Set(['\r', '\x03', '\x15']);
const ERASES_ONE = new Set(['\x7f', '\b']);
const CONTROL = /[\x00-\x09\x0b-\x1f\x80-\x9f]/;

export function draftLengthAfter(length: number, keys: string): number {
  let current = length;
  for (const { groups } of keys.matchAll(TOKENS)) {
    if (groups?.pasted !== undefined) current += [...groups.pasted].length;
    else if (groups?.newline) current += 1;
    else if (groups?.recall) current = Infinity;
    else if (groups?.char && CLEARS_THE_BOX.has(groups.char)) current = 0;
    else if (groups?.char && ERASES_ONE.has(groups.char)) current = Math.max(0, current - 1);
    else if (groups?.char && !CONTROL.test(groups.char)) current += 1;
  }
  return current;
}
