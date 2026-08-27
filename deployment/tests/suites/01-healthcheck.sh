#!/bin/sh
set -e

. /scripts/lib/common.sh

echo ""
echo "=== Section 1: Healthcheck ==="

echo "1. GET /healthcheck"
assert_status GET "$BASE_URL/healthcheck" 200
assert_jq '.status == "ok"' 'status is "ok"'
assert_jq '.timestamp | type == "string" and test("^\\d{4}-\\d{2}-\\d{2}T")' 'valid ISO timestamp present'
