export const STEP_FILE_ENV = 'HATSTAND_STEP_FILE';
export const STEP_DONE_COMMAND = 'hatstand-step-done';

// Each call adds lines, so the reports of several steps are all kept until Hatstand reads them.
export const STEP_DONE_TOOL = `#!/bin/sh
if [ "$#" -eq 0 ]; then
  echo 'Usage: hatstand-step-done <step number> [more step numbers]' >&2
  exit 2
fi
for step in "$@"; do
  case "$step" in
    '' | *[!0-9]* | 0*)
      echo 'Usage: hatstand-step-done <step number> [more step numbers]' >&2
      exit 2
      ;;
  esac
done
if [ -z "$${STEP_FILE_ENV}" ]; then
  echo 'hatstand-step-done only works inside a Hatstand session.' >&2
  exit 2
fi
for step in "$@"; do
  printf '%s\\n' "$step" >> "$${STEP_FILE_ENV}"
done
echo "Hatstand knows you finished step $*. The person sees it and decides when to move on."
`;

/** Every step number in the text, one per line or separated by spaces. Anything else is ignored. */
export function parseStepsDone(text: string): number[] {
  const steps = text.split(/\s+/).filter((word) => /^[1-9]\d*$/.test(word)).map(Number);
  return [...new Set(steps)];
}

/** Adds reported steps to the finished ones, keeping only steps the guide has, in order. */
export function withStepsDone(done: number[], reported: number[], stepCount: number): number[] {
  return [...new Set([...done, ...reported])].filter((step) => step <= stepCount).sort((a, b) => a - b);
}
