#!/bin/sh
set -e

. /scripts/lib/common.sh

TOKEN=$(get_admin_token)
REG_TOKEN=$(get_user_token)

# Ensure a test channel exists for endpoint checks
CHAN_ID=$(psql_run -t -A -c "SELECT \"id\" FROM channel LIMIT 1;")
if [ -z "$CHAN_ID" ]; then
  req POST "$BASE_URL/channels" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"Security Test Radio","visibility":"public"}'
  CHAN_ID=$(echo "$BODY" | jq -r '.id')
fi

echo ""
echo "=== Section 4: Security & Route Guards ==="

echo "26. POST /admin/feeds/scrape (No Auth -> 401)"
assert_status POST "$BASE_URL/admin/feeds/scrape" 401 \
  -H "Content-Type: application/json" -d '{"subredditName":"AskReddit"}'
assert_jq '.statusCode == 401' 'body confirms 401'

echo "27. POST /admin/feeds/scrape (Regular Token -> 403)"
assert_status POST "$BASE_URL/admin/feeds/scrape" 403 \
  -H "Authorization: Bearer $REG_TOKEN" \
  -H "Content-Type: application/json" -d '{"subredditName":"AskReddit"}'
assert_jq '.statusCode == 403' 'body confirms 403'

echo "28. GET /admin/feeds/subreddits (No Auth -> 401)"
assert_status GET "$BASE_URL/admin/feeds/subreddits" 401
assert_jq '.statusCode == 401' 'body confirms 401'

echo "29. GET /admin/feeds/subreddits (Regular Token -> 403)"
assert_status GET "$BASE_URL/admin/feeds/subreddits" 403 \
  -H "Authorization: Bearer $REG_TOKEN"
assert_jq '.statusCode == 403' 'body confirms 403'

echo "30. DELETE /admin/feeds/cache (No Auth -> 401)"
assert_status DELETE "$BASE_URL/admin/feeds/cache" 401
assert_jq '.statusCode == 401' 'body confirms 401'

echo "31. DELETE /admin/feeds/cache (Regular Token -> 403)"
assert_status DELETE "$BASE_URL/admin/feeds/cache" 403 \
  -H "Authorization: Bearer $REG_TOKEN"
assert_jq '.statusCode == 403' 'body confirms 403'

echo "32. GET /admin/channels/$CHAN_ID/topics (No Auth -> 401)"
assert_status GET "$BASE_URL/admin/channels/$CHAN_ID/topics" 401
assert_jq '.statusCode == 401' 'body confirms 401'

echo "33. GET /admin/channels/$CHAN_ID/topics (Regular Token -> 403)"
assert_status GET "$BASE_URL/admin/channels/$CHAN_ID/topics" 403 \
  -H "Authorization: Bearer $REG_TOKEN"
assert_jq '.statusCode == 403' 'body confirms 403'
