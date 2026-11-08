export const COPY_REQUESTS_ENV = 'HATSTAND_COPY_REQUESTS';
export const READ_ONLY_REPOS_ENV = 'HATSTAND_READ_ONLY_REPOS';

const WAIT_SECONDS = 120;

export const EDIT_REPO_TOOL = `#!/bin/sh
if [ -z "$1" ]; then
  echo 'Usage: hatstand-edit-repo "<repository name>"' >&2
  exit 2
fi
if [ -z "$${COPY_REQUESTS_ENV}" ]; then
  echo 'hatstand-edit-repo only works inside a Hatstand session.' >&2
  exit 2
fi
base="$${COPY_REQUESTS_ENV}/$$-$(date +%s)"
printf '%s' "$1" > "$base.tmp" && mv "$base.tmp" "$base.request"
waited=0
while [ "$waited" -lt ${WAIT_SECONDS} ]; do
  if [ -f "$base.ok" ]; then
    cat "$base.ok"
    rm -f "$base.ok"
    exit 0
  fi
  if [ -f "$base.error" ]; then
    cat "$base.error" >&2
    rm -f "$base.error"
    exit 1
  fi
  sleep 1
  waited=$((waited + 1))
done
echo 'Hatstand did not answer. Tell the person the copy could not be created.' >&2
exit 1
`;
