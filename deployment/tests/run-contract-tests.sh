#!/bin/sh
# Tier 2: short contract probes against real providers.
#
# Deliberately separate from run-docker-test.sh (Tier 1). The two tiers are
# never run together: Tier 1 is the full suite against mocks, Tier 2 is these
# probes against the real thing. The probes live in contracts/, not suites/,
# so the docker runner cannot reach them even by accident.
set -e
cd "$(dirname "$0")"

if [ -f ../../.env ]; then
  set -a
  . ../../.env
  set +a
fi

for probe in contracts/*.ts; do
  npx ts-node --transpile-only "$probe"
done
