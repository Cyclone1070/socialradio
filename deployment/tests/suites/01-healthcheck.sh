#!/bin/sh
set -e

. /scripts/lib/common.sh

echo ""
echo "=== Section 1: Healthcheck ==="

echo "1. GET /healthcheck on every instance"
assert_status GET "$BASE_URL/healthcheck" 200
assert_jq '.status == "ok"' 'status is "ok"'
assert_jq '.timestamp | type == "string" and test("^\\d{4}-\\d{2}-\\d{2}T")' 'valid ISO timestamp present'

# A stack is only healthy if each process is: one instance answering is not a
# stack that can serve, and this is the suite that is supposed to say so.
if [ "$INSTANCE_TWO_URL" != "$INSTANCE_ONE_URL" ]; then
  echo "1b. The second instance is healthy too ($(instance_name "$INSTANCE_TWO_URL"))"
  ON_TWO
  assert_status GET "$BASE_URL/healthcheck" 200
  assert_jq '.status == "ok"' 'second instance reports "ok"'
fi
