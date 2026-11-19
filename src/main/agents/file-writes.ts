// The files an agent wrote with its own tools. A hook of each agent adds one short line per file to the
// activity file of the session, and this reads those lines back.
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { ACTIVITY_FILE_ENV } from './types';

export const FILE_WRITE_EVENT = 'HatstandFileWrite';
export const CLAUDE_WRITE_TOOLS = 'Write|Edit|MultiEdit|NotebookEdit';

const JSON_STRING = `"([^"\\\\]|\\\\.)*"`;
const line = (kind: string, members: string) => `printf '{"hook_event_name":"${FILE_WRITE_EVENT}","kind":"%s"%s}\\n' ${kind} ${members} >> "$${ACTIVITY_FILE_ENV}"`;

/**
 * Keeps only the path of the file, because the input of the hook also carries the whole content, and the
 * activity file is read again on every poll.
 */
export const CLAUDE_WRITE_COMMAND = [
  `input=$(cat)`,
  `path=$(printf '%s' "$input" | grep -oE '"(file_path|notebook_path)" *: *${JSON_STRING}' | head -n 1)`,
  `if [ -z "$path" ]; then exit 0; fi`,
  `kind=update`,
  `if printf '%s' "$input" | grep -Eq '"type" *: *"create"'; then kind=create; fi`,
  line('"$kind"', '",$path"'),
].join('; ');

/**
 * Copilot sends the arguments of a tool as text inside its JSON, so the quotes are unescaped first.
 * `apply_patch` names its files in the patch, one line each, and may use paths relative to the folder it runs in.
 */
export const COPILOT_WRITE_COMMAND = [
  `input=$(sed 's/\\\\"/"/g')`,
  `tool=$(printf '%s' "$input" | grep -oE '"toolName" *: *"[a-z_]+"' | head -n 1)`,
  `cwd=$(printf '%s' "$input" | grep -oE '"cwd" *: *${JSON_STRING}' | head -n 1)`,
  `case "$tool" in ` +
    [
      `*'"create"'|*'"edit"'|*'"str_replace_editor"') ` +
        [
          `if printf '%s' "$input" | grep -Eq '"command" *: *"view"'; then exit 0; fi`,
          `path=$(printf '%s' "$input" | grep -oE '"path" *: *${JSON_STRING}' | head -n 1)`,
          `if [ -z "$path" ]; then exit 0; fi`,
          `kind=update`,
          `case "$tool" in *'"create"') kind=create;; esac`,
          `if printf '%s' "$input" | grep -Eq '"command" *: *"create"'; then kind=create; fi`,
          line('"$kind"', '",$path"'),
        ].join('; ') +
        `;;`,
      `*'"apply_patch"') printf '%s' "$input" | grep -oE '\\*\\*\\* (Add|Update|Delete) File: [^"\\\\]+' | while IFS= read -r found; do ` +
        [
          `kind=update`,
          `case "$found" in *'Add File: '*) kind=create;; *'Delete File: '*) kind=delete;; esac`,
          line('"$kind"', `",\\"path\\":\\"\${found#*File: }\\"\${cwd:+,$cwd}"`),
        ].join('; ') +
        `; done;;`,
    ].join(' ') +
    ` esac`,
].join('; ');

const writeSchema = z.object({
  hook_event_name: z.literal(FILE_WRITE_EVENT),
  kind: z.enum(['create', 'update', 'delete']),
  file_path: z.string().optional(),
  notebook_path: z.string().optional(),
  path: z.string().optional(),
  cwd: z.string().optional(),
});

export type FileWrite = { path: string; kind: z.infer<typeof writeSchema>['kind'] };

function parseLine(text: string): FileWrite | undefined {
  try {
    const event = writeSchema.safeParse(JSON.parse(text)).data;
    const path = event?.file_path ?? event?.notebook_path ?? event?.path;
    if (!event || !path) return undefined;
    if (isAbsolute(path)) return { path: resolve(path), kind: event.kind };
    return event.cwd && isAbsolute(event.cwd) ? { path: resolve(event.cwd, path), kind: event.kind } : undefined;
  } catch {
    return undefined;
  }
}

/** The files written, in the order the agent wrote them. A line of anything else in the activity file is skipped. */
export function parseFileWrites(activity: string): FileWrite[] {
  return activity
    .split('\n')
    .filter((text) => text.includes(FILE_WRITE_EVENT))
    .map(parseLine)
    .filter((write) => write !== undefined);
}
