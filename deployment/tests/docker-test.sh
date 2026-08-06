#!/bin/sh
set -e

fail() {
  echo "  FAIL: $*"
  exit 1
}

# Performs a request and captures STATUS + BODY globally.
# usage: req METHOD URL [curl args...]
req() {
  method="$1"
  url="$2"
  shift 2
  RESP=$(curl -s -w '\n%{http_code}' -X "$method" "$url" "$@")
  STATUS=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')
}

assert_status() {
  method="$1"
  url="$2"
  expected="$3"
  shift 3
  req "$method" "$url" "$@"
  echo "  Status: $STATUS (expected $expected)"
  if [ "$STATUS" != "$expected" ]; then
    [ -n "$BODY" ] && echo "  Body: $BODY"
    fail "expected $expected, got $STATUS"
  fi
}

assert_2xx() {
  method="$1"
  url="$2"
  shift 2
  req "$method" "$url" "$@"
  echo "  Status: $STATUS (expected 2xx)"
  if [ "$STATUS" != "200" ] && [ "$STATUS" != "201" ]; then
    [ -n "$BODY" ] && echo "  Body: $BODY"
    fail "expected 200/201, got $STATUS"
  fi
}

# Asserts the captured BODY satisfies a jq expression.
# usage: assert_jq EXPR [description]
assert_jq() {
  expr="$1"
  desc="$2"
  if ! echo "$BODY" | jq -e "$expr" >/dev/null 2>&1; then
    echo "  Body: $BODY"
    fail "jq assertion failed: $expr ($desc)"
  fi
  echo "  ✓ $desc"
}

assert_empty_body() {
  if [ -n "$BODY" ]; then
    fail "expected empty body, got: $BODY"
  fi
  echo "  ✓ empty body"
}

EMAIL="${ADMIN_EMAIL:?ADMIN_EMAIL is required}"
PASSWORD="${ADMIN_PASSWORD:?ADMIN_PASSWORD is required}"
BASE_URL="${TARGET_URL:?TARGET_URL is required}"

# ── SQL fixtures ──────────────────────────────────────────────────────
# One SQL pattern for the whole suite: every database change runs through
# this single helper (psql against the app DB). Boot fixtures are .sql files
# applied here; mid-suite fixtures use the same helper with psql variables
# (e.g. -v chan_id=... -f /scripts/dead-sub-fixture.sql).
psql_run() {
  PGPASSWORD=postgres psql -h db -U postgres -d socialradio \
    -v ON_ERROR_STOP=1 "$@"
}

echo "SQL fixture 0: seed-test-user.sql (non-admin user)"
psql_run -f /scripts/seed-test-user.sql >/dev/null || fail "seed-test-user.sql failed"
echo "  ✓ user fixture seeded"

# ── Section 1: Healthcheck ────────────────────────────────────────────

echo ""
echo "=== Section 1: Healthcheck ==="

echo "1. GET /healthcheck"
assert_status GET "$BASE_URL/healthcheck" 200
assert_jq '.status == "ok"' 'status is "ok"'
assert_jq '.timestamp | type == "string" and length > 0' 'timestamp present'

# ── Section 2: Auth & Identity ────────────────────────────────────────

echo ""
echo "=== Section 2: Auth & Identity ==="

echo "2. POST /auth/login (Admin -> 200/201)"
assert_2xx POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}"
TOKEN=$(echo "$BODY" | jq -r '.accessToken // empty')
[ -n "$TOKEN" ] || fail "missing accessToken"
echo "  Token acquired (admin)"

echo "3. GET /users/me (Admin -> 200)"
assert_status GET "$BASE_URL/users/me" 200 -H "Authorization: Bearer $TOKEN"
assert_jq '.email == "'"$EMAIL"'"' 'email matches admin email'
assert_jq '.id | type == "string" and length > 0' 'id present'
assert_jq '.createdAt | type == "string" and length > 0' 'createdAt present'

echo "4. POST /auth/login (Regular User -> 200/201)"
assert_2xx POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@socialradio.com","password":"UserPass123!"}'
REG_TOKEN=$(echo "$BODY" | jq -r '.accessToken // empty')
[ -n "$REG_TOKEN" ] || fail "missing accessToken"
echo "  Token acquired (user)"

echo "5. POST /auth/login (Empty JSON Body -> 400)"
assert_status POST "$BASE_URL/auth/login" 400 \
  -H "Content-Type: application/json" -d '{}'
assert_jq '.statusCode == 400' 'body confirms 400'
assert_jq '(.message | type == "array" and length > 0)' 'validation messages present'

echo "6. POST /auth/login (Invalid Email -> 400)"
assert_status POST "$BASE_URL/auth/login" 400 \
  -H "Content-Type: application/json" -d '{"email":"not-an-email","password":"123"}'
assert_jq '.statusCode == 400' 'body confirms 400'
assert_jq '(.message | tostring | test("email"; "i"))' 'message mentions email'

echo "7. POST /auth/login (Wrong Password -> 401)"
assert_status POST "$BASE_URL/auth/login" 401 \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"WrongPass999!\"}"
assert_jq '.message == "Invalid credentials"' 'no user enumeration message'

echo "8. POST /auth/login (Non-existent Email -> 401)"
assert_status POST "$BASE_URL/auth/login" 401 \
  -H "Content-Type: application/json" \
  -d '{"email":"ghost@nonexistent.com","password":"Password123!"}'
assert_jq '.message == "Invalid credentials"' 'same message as wrong password'

echo "9. GET /users/me (No Auth -> 401)"
assert_status GET "$BASE_URL/users/me" 401
assert_jq '.statusCode == 401' 'body confirms 401'

echo "10. GET /users/me (Malformed JWT -> 401)"
assert_status GET "$BASE_URL/users/me" 401 \
  -H "Authorization: Bearer malformed_jwt_garbage_token"
assert_jq '.statusCode == 401' 'body confirms 401'

# ── Section 3: Channels & Subreddits ─────────────────────────────────

echo ""
echo "=== Section 3: Channels & Subreddits ==="

echo "11. POST /channels (Create -> 201)"
assert_2xx POST "$BASE_URL/channels" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Blackbox E2E Station"}'
CHAN_ID=$(echo "$BODY" | jq -r '.id // empty')
[ -n "$CHAN_ID" ] || fail "missing id"
assert_jq '.name == "Blackbox E2E Station"' 'name matches'
assert_jq '.visibility | type == "string" and length > 0' 'visibility present'
assert_jq '.createdAt | type == "string" and length > 0' 'createdAt present'
echo "  Channel ID: $CHAN_ID"

echo "12. GET /channels (List -> 200)"
assert_status GET "$BASE_URL/channels" 200 -H "Authorization: Bearer $TOKEN"
assert_jq 'map(.name) | index("Blackbox E2E Station") != null' 'list contains the channel'

echo "13. POST /channels/$CHAN_ID/subreddits (Subscribe r/AskReddit)"
assert_2xx POST "$BASE_URL/channels/$CHAN_ID/subreddits" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"subredditName":"AskReddit"}'
assert_empty_body
assert_status GET "$BASE_URL/channels/$CHAN_ID/subreddits" 200 \
  -H "Authorization: Bearer $TOKEN"
assert_jq 'map(.name) | index("askreddit") != null' 'AskReddit in list (read-back)'

echo "14. POST /channels/$CHAN_ID/subreddits (Duplicate r/AskReddit)"
assert_2xx POST "$BASE_URL/channels/$CHAN_ID/subreddits" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"subredditName":"AskReddit"}'
assert_empty_body
assert_status GET "$BASE_URL/channels/$CHAN_ID/subreddits" 200 \
  -H "Authorization: Bearer $TOKEN"
assert_jq 'map(select(.name == "askreddit")) | length == 1' 'exactly one AskReddit (idempotent)'

echo "15. DELETE /channels/$CHAN_ID/subreddits/AskReddit -> 200"
assert_status DELETE "$BASE_URL/channels/$CHAN_ID/subreddits/AskReddit" 200 \
  -H "Authorization: Bearer $TOKEN"
assert_empty_body
assert_status GET "$BASE_URL/channels/$CHAN_ID/subreddits" 200 \
  -H "Authorization: Bearer $TOKEN"
assert_jq 'map(.name) | index("askreddit") == null' 'AskReddit gone (read-back)'

echo "16. POST /channels/$CHAN_ID/subreddits (Re-subscribe r/AskReddit)"
assert_2xx POST "$BASE_URL/channels/$CHAN_ID/subreddits" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"subredditName":"AskReddit"}'
assert_empty_body
assert_status GET "$BASE_URL/channels/$CHAN_ID/subreddits" 200 \
  -H "Authorization: Bearer $TOKEN"
assert_jq 'map(.name) | index("askreddit") != null' 'AskReddit back in list'

echo "17. POST /channels (Empty Name -> 400)"
assert_status POST "$BASE_URL/channels" 400 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"name":""}'
assert_jq '.statusCode == 400' 'body confirms 400'
assert_jq '(.message | tostring | test("name"; "i"))' 'message mentions name'

echo "18. POST /channels/000.../subreddits (Fake UUID -> 404)"
assert_status POST "$BASE_URL/channels/00000000-0000-0000-0000-000000000000/subreddits" 404 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"subredditName":"AskReddit"}'
assert_jq '.message == "Channel not found"' '404 message'

echo "19. POST /channels (No Auth -> 401)"
assert_status POST "$BASE_URL/channels" 401 \
  -H "Content-Type: application/json" -d '{"name":"Hacker Station"}'
assert_jq '.statusCode == 401' 'body confirms 401'

echo "20. POST /channels/$CHAN_ID/subreddits (No Auth -> 401)"
assert_status POST "$BASE_URL/channels/$CHAN_ID/subreddits" 401 \
  -H "Content-Type: application/json" -d '{"subredditName":"AskReddit"}'
assert_jq '.statusCode == 401' 'body confirms 401'

echo "21. DELETE /channels/$CHAN_ID/subreddits/AskReddit (No Auth -> 401)"
assert_status DELETE "$BASE_URL/channels/$CHAN_ID/subreddits/AskReddit" 401
assert_jq '.statusCode == 401' 'body confirms 401'

echo "22. POST /channels/$CHAN_ID/subreddits (Invalid body -> 400)"
assert_status POST "$BASE_URL/channels/$CHAN_ID/subreddits" 400 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"subredditName":123}'
assert_jq '.statusCode == 400' 'body confirms 400'

echo "23. DELETE /channels/$CHAN_ID/subreddits/nonexistent_subreddit_e2e_92831 (Not subscribed -> 404)"
assert_status DELETE "$BASE_URL/channels/$CHAN_ID/subreddits/nonexistent_subreddit_e2e_92831" 404 \
  -H "Authorization: Bearer $TOKEN"
assert_jq '.message == "Subreddit not found"' '404 message'

# ── Section 4: Admin & Feeds ─────────────────────────────────────────

echo ""
echo "=== Section 4: Admin & Feeds ==="

echo "24. POST /admin/feeds/scrape (Admin Token, r/AskReddit)"
assert_2xx POST "$BASE_URL/admin/feeds/scrape" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"subredditName":"AskReddit"}'
COUNT=$(echo "$BODY" | jq -r '.scrapedPostsCount // 0')
echo "  Scraped posts: $COUNT"
[ "$COUNT" -gt 0 ] 2>/dev/null || fail "expected scrapedPostsCount > 0, got: $BODY"

echo "25. GET /admin/feeds/subreddits (Admin -> 200)"
assert_status GET "$BASE_URL/admin/feeds/subreddits" 200 -H "Authorization: Bearer $TOKEN"
assert_jq 'map(.name) | index("askreddit") != null' 'askreddit present in list'

echo "26. POST /admin/feeds/scrape (Dead sub -> 2xx, zero posts)"
assert_2xx POST "$BASE_URL/admin/feeds/scrape" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"subredditName":"nonexistent_subreddit_e2e_92831"}'
DEAD_COUNT=$(echo "$BODY" | jq -r '.scrapedPostsCount // 0')
echo "  Scraped posts: $DEAD_COUNT"
[ "$DEAD_COUNT" = "0" ] || fail "expected scrapedPostsCount 0, got: $BODY"

echo "27. GET /admin/feeds/subreddits (Dead sub deleted -> not in list)"
assert_status GET "$BASE_URL/admin/feeds/subreddits" 200 -H "Authorization: Bearer $TOKEN"
assert_jq 'map(.name) | index("nonexistent_subreddit_e2e_92831") == null' 'dead sub gone (isInvalid chain)'

echo "28. SQL fixture: subscribe channel to dead_prod_sub_e2e_77401 (behind the API gate)"
psql_run -v chan_id="$CHAN_ID" -f /scripts/dead-sub-fixture.sql >/dev/null \
  || fail "dead-sub fixture failed"
assert_status GET "$BASE_URL/channels/$CHAN_ID/subreddits" 200 \
  -H "Authorization: Bearer $TOKEN"
assert_jq 'map(.name) | index("dead_prod_sub_e2e_77401") != null' 'dead sub subscribed (fixture applied)'

echo "29. GET /admin/channels/$CHAN_ID/topics (triggers the prod background scrape chain)"
assert_status GET "$BASE_URL/admin/channels/$CHAN_ID/topics" 200 \
  -H "Authorization: Bearer $TOKEN"
assert_jq '.id | type == "string" and length > 0' 'topic id present (phase 2 unaffected by chain)'

echo "30. Poll: dead sub auto-unsubscribed by the prod scrape chain"
GONE=1
i=0
while [ $i -lt 45 ]; do
  req GET "$BASE_URL/channels/$CHAN_ID/subreddits" -H "Authorization: Bearer $TOKEN"
  if echo "$BODY" | jq -e 'map(.name) | index("dead_prod_sub_e2e_77401") == null' >/dev/null 2>&1; then
    GONE=0
    break
  fi
  i=$((i+1))
  sleep 3
done
[ "$GONE" = 0 ] || fail "dead sub still subscribed after 135s (chain delete + cascade did not run)"
echo "  ✓ dead sub gone (chain isInvalid -> delete -> cascade) after ~$((i * 3))s"

echo "31. GET /admin/channels/$CHAN_ID/topics (Admin -> 200)"
assert_status GET "$BASE_URL/admin/channels/$CHAN_ID/topics" 200 \
  -H "Authorization: Bearer $TOKEN"
assert_jq '.id | type == "string" and length > 0' 'topic id present'
assert_jq '(.posts | type == "array" and length > 0)' 'non-empty posts array'

echo "32. DELETE /admin/feeds/cache (Admin -> 200)"
assert_status DELETE "$BASE_URL/admin/feeds/cache" 200 -H "Authorization: Bearer $TOKEN"
assert_empty_body

echo "33. POST /admin/feeds/scrape (No Auth -> 401)"
assert_status POST "$BASE_URL/admin/feeds/scrape" 401 \
  -H "Content-Type: application/json" -d '{"subredditName":"AskReddit"}'
assert_jq '.statusCode == 401' 'body confirms 401'

echo "34. POST /admin/feeds/scrape (Tampered JWT -> 401)"
assert_status POST "$BASE_URL/admin/feeds/scrape" 401 \
  -H "Authorization: Bearer ${TOKEN}tampered" \
  -H "Content-Type: application/json" -d '{"subredditName":"AskReddit"}'
assert_jq '.statusCode == 401' 'body confirms 401'

echo "35. POST /admin/feeds/scrape (Regular Token -> 403)"
assert_status POST "$BASE_URL/admin/feeds/scrape" 403 \
  -H "Authorization: Bearer $REG_TOKEN" \
  -H "Content-Type: application/json" -d '{"subredditName":"AskReddit"}'
assert_jq '.statusCode == 403' 'body confirms 403'

echo "36. GET /admin/feeds/subreddits (No Auth -> 401)"
assert_status GET "$BASE_URL/admin/feeds/subreddits" 401
assert_jq '.statusCode == 401' 'body confirms 401'

echo "37. GET /admin/feeds/subreddits (Regular Token -> 403)"
assert_status GET "$BASE_URL/admin/feeds/subreddits" 403 \
  -H "Authorization: Bearer $REG_TOKEN"
assert_jq '.statusCode == 403' 'body confirms 403'

echo "38. DELETE /admin/feeds/cache (No Auth -> 401)"
assert_status DELETE "$BASE_URL/admin/feeds/cache" 401
assert_jq '.statusCode == 401' 'body confirms 401'

echo "39. DELETE /admin/feeds/cache (Regular Token -> 403)"
assert_status DELETE "$BASE_URL/admin/feeds/cache" 403 \
  -H "Authorization: Bearer $REG_TOKEN"
assert_jq '.statusCode == 403' 'body confirms 403'

echo "40. GET /admin/channels/$CHAN_ID/topics (No Auth -> 401)"
assert_status GET "$BASE_URL/admin/channels/$CHAN_ID/topics" 401
assert_jq '.statusCode == 401' 'body confirms 401'

echo "41. GET /admin/channels/$CHAN_ID/topics (Regular Token -> 403)"
assert_status GET "$BASE_URL/admin/channels/$CHAN_ID/topics" 403 \
  -H "Authorization: Bearer $REG_TOKEN"
assert_jq '.statusCode == 403' 'body confirms 403'

echo ""
echo "OK - all checks passed"
