export const PLAN_CHECKS_ENV = 'HATSTAND_PLAN_CHECKS';
export const CHECK_PLAN_COMMAND = 'hatstand-check-plan';

const WAIT_SECONDS = 30;

export const CHECK_PLAN_TOOL = `#!/bin/sh
if [ -z "$${PLAN_CHECKS_ENV}" ]; then
  echo '${CHECK_PLAN_COMMAND} only works inside a Hatstand session that plans a backlog.' >&2
  exit 2
fi
base="$${PLAN_CHECKS_ENV}/$$-$(date +%s)"
printf 'check' > "$base.tmp" && mv "$base.tmp" "$base.request"
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
echo 'Hatstand did not answer. Tell the person the plan could not be checked.' >&2
exit 1
`;
