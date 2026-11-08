export const STEP_FILE_ENV = 'HATSTAND_STEP_FILE';
export const STEP_DONE_COMMAND = 'hatstand-step-done';
export const CLEAR_STEP_DONE = `printf '' > "$${STEP_FILE_ENV}"`;

export const STEP_DONE_TOOL = `#!/bin/sh
case "$1" in
  '' | *[!0-9]*)
    echo 'Usage: hatstand-step-done <step number>' >&2
    exit 2
    ;;
esac
if [ -z "$${STEP_FILE_ENV}" ]; then
  echo 'hatstand-step-done only works inside a Hatstand session.' >&2
  exit 2
fi
printf '%s' "$1" > "$${STEP_FILE_ENV}"
echo "Hatstand knows step $1 is finished. The person decides when to move on, so stop here and report."
`;

export function parseStepDone(text: string): number | undefined {
  return /^[1-9]\d*$/.test(text.trim()) ? Number(text.trim()) : undefined;
}
