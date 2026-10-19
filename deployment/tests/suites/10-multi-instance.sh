#!/bin/sh
set -e

. /scripts/lib/common.sh

TOKEN=$(get_admin_token)
ensure_base_fixtures
APP2_URL="${INSTANCE_TWO_URL:?the second instance must be addressed, not guessed}"
APP1_URL="${INSTANCE_ONE_URL:?the first instance must be addressed, not guessed}"
MOCKS_URL="${LLM_STUB_URL:-http://mocks:4010}"

# How many seconds to wait for a condition, polled rather than slept on: every wait
# in this suite is driven by a row in the database, so a slow machine changes how
# long a wait takes, never what the suite concludes.
wait_for() {
  DEADLINE=$(( $(date +%s) + $1 ))
  shift
  while [ "$(date +%s)" -lt "$DEADLINE" ]; do
    if [ "$(eval "$1")" = "$2" ]; then return 0; fi
    sleep 1
  done
  return 1
}

wait_until_not() {
  DEADLINE=$(( $(date +%s) + $1 ))
  shift
  while [ "$(date +%s)" -lt "$DEADLINE" ]; do
    if [ "$(eval "$1")" != "$2" ]; then return 0; fi
    sleep 1
  done
  return 1
}

claim_of() {
  psql_run -t -A -c "SELECT COALESCE(buffer_claim_id, 'none') FROM channel WHERE id = '$1';"
}

echo ""
echo "=== Section 10: Two instances, one station ==="
echo "  app   -> $BASE_URL"
echo "  app2  -> $APP2_URL"

echo "62. Both instances see the same station and the same claim row"
ON_TWO
assert_status GET "$BASE_URL/healthcheck" 200
echo "  ✓ the second instance answers"

req POST "$MOCKS_URL/__control" -H "Content-Type: application/json" -d '{"mode":"normal","delayMs":0}'
[ "$STATUS" = "200" ] || fail "could not reset the model stub (HTTP $STATUS)"

# ---- 63: exactly one instance fills an empty station -------------------------
echo "63. Asking both instances at once about an empty station fills it once"
ON_ONE
assert_status POST "$BASE_URL/channels" 201 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Two Instance Empty Station","visibility":"public"}'
RACE_CHAN_ID=$(echo "$BODY" | jq -r '.id')

# No subreddits: the run has nothing to generate, so the only writer is the filler.
curl -s -o /tmp/race-app.json -w "%{http_code}" "$APP1_URL/channels/$RACE_CHAN_ID/live.m3u8" > /tmp/race-app.code &
RACE_A=$!
curl -s -o /tmp/race-app2.json -w "%{http_code}" "$APP2_URL/channels/$RACE_CHAN_ID/live.m3u8" > /tmp/race-app2.code &
RACE_B=$!
wait "$RACE_A" "$RACE_B"

CODE_A=$(cat /tmp/race-app.code)
CODE_B=$(cat /tmp/race-app2.code)
if [ "$CODE_A" != "200" ] || [ "$CODE_B" != "200" ]; then
  fail "concurrent cold starts returned $CODE_A and $CODE_B instead of 200 and 200"
fi
FILLER_ROWS=$(psql_run -t -A -c "SELECT COUNT(*) FROM segment WHERE \"channel_id\" = '$RACE_CHAN_ID';")
if [ "$FILLER_ROWS" != "2" ]; then
  fail "two instances noticed the same hole and wrote $FILLER_ROWS rows; one filler is two songs"
fi
echo "  ✓ both requests answered, and the station was filled exactly once ($FILLER_ROWS songs)"

# ---- 64: the second instance stands down while a claim is live ---------------
echo "64. While one instance is generating, the other leaves the station alone"
psql_run -c "DELETE FROM channel_post_progress; DELETE FROM comment; DELETE FROM post;" >/dev/null
psql_run -f /scripts/fixtures/ai-talk.sql >/dev/null || fail "ai-talk.sql fixture failed"
req POST "$MOCKS_URL/__control" -H "Content-Type: application/json" -d '{"mode":"normal","delayMs":1500}'
[ "$STATUS" = "200" ] || fail "could not slow the model stub down"

ON_ONE
assert_status POST "$BASE_URL/channels" 201 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Two Instance Claim Station","visibility":"public"}'
CLAIM_CHAN_ID=$(echo "$BODY" | jq -r '.id')
ON_ONE
assert_status POST "$BASE_URL/channels/$CLAIM_CHAN_ID/subreddits" 201 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subredditName":"ai_talk_fixture_sub_e2e"}'

ON_ONE
assert_status GET "$BASE_URL/channels/$CLAIM_CHAN_ID/live.m3u8" 200
wait_until_not 25 "claim_of $CLAIM_CHAN_ID" "none" \
  || fail "the first instance never claimed the station while it was generating"
CLAIM_BEFORE=$(claim_of "$CLAIM_CHAN_ID")
echo "  ✓ the first instance holds the claim ($(echo "$CLAIM_BEFORE" | cut -c1-8)...)"

ON_TWO
assert_status GET "$BASE_URL/channels/$CLAIM_CHAN_ID/live.m3u8" 200
CLAIM_AFTER=$(claim_of "$CLAIM_CHAN_ID")
if [ "$CLAIM_AFTER" != "$CLAIM_BEFORE" ]; then
  fail "the second instance took a claim that was still alive ($CLAIM_BEFORE -> $CLAIM_AFTER)"
fi
echo "  ✓ the second instance served its request without touching the claim"

# Let the run finish at full speed.
req POST "$MOCKS_URL/__control" -H "Content-Type: application/json" -d '{"delayMs":0}'
if ! wait_for 40 "claim_of $CLAIM_CHAN_ID" "none"; then
  fail "the claim was never released when the run finished"
fi
echo "  ✓ the claim was released when the run finished"

# ---- 65: a claim whose owner went quiet is taken over, and the old block is refused
echo "65. When the owner goes quiet the other instance takes over, and the dead run's block is refused"
req POST "$MOCKS_URL/__control" -H "Content-Type: application/json" -d '{"delayMs":4000}'
[ "$STATUS" = "200" ] || fail "could not slow the model stub down"

psql_run -c "DELETE FROM channel_post_progress; DELETE FROM comment; DELETE FROM post;" >/dev/null
psql_run -f /scripts/fixtures/ai-talk.sql >/dev/null || fail "ai-talk.sql fixture failed"
ON_ONE
assert_status POST "$BASE_URL/channels" 201 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Two Instance Takeover Station","visibility":"public"}'
TAKEOVER_CHAN_ID=$(echo "$BODY" | jq -r '.id')
ON_ONE
assert_status POST "$BASE_URL/channels/$TAKEOVER_CHAN_ID/subreddits" 201 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subredditName":"ai_talk_fixture_sub_e2e"}'

ON_ONE
assert_status GET "$BASE_URL/channels/$TAKEOVER_CHAN_ID/live.m3u8" 200
wait_until_not 25 "claim_of $TAKEOVER_CHAN_ID" "none" \
  || fail "the first instance never claimed the takeover station"
CLAIM_OWNER=$(claim_of "$TAKEOVER_CHAN_ID")

# The owner is still generating - to the database it is simply an old claim.
# Backdating it is how a dead instance looks, without killing a container.
psql_run -c "UPDATE channel SET buffer_claimed_at = now() - interval '10 minutes' WHERE id = '$TAKEOVER_CHAN_ID';" >/dev/null
ON_TWO
assert_status GET "$BASE_URL/channels/$TAKEOVER_CHAN_ID/live.m3u8" 200
TAKEOVER_CLAIM=$(claim_of "$TAKEOVER_CHAN_ID")
if [ "$TAKEOVER_CLAIM" = "$CLAIM_OWNER" ]; then
  fail "the second instance left a stale claim in place instead of taking over"
fi
echo "  ✓ the second instance took over the stale claim"

req POST "$MOCKS_URL/__control" -H "Content-Type: application/json" -d '{"delayMs":0}'
if ! wait_for 60 "claim_of $TAKEOVER_CHAN_ID" "none"; then
  fail "the station was left claimed after both runs stopped"
fi
echo "  ✓ neither instance left the station claimed"

DUPLICATES=$(psql_run -t -A -c "SELECT COUNT(*) FROM (SELECT cluster_id FROM segment WHERE \"channel_id\" = '$TAKEOVER_CHAN_ID' AND type = 'talk' GROUP BY cluster_id HAVING COUNT(*) > 1) d;")
if [ "$DUPLICATES" != "0" ]; then
  fail "$DUPLICATES topic(s) aired twice after a takeover - the dead run's block was not refused"
fi
TAKEOVER_TALK=$(psql_run -t -A -c "SELECT COUNT(*) FROM segment WHERE \"channel_id\" = '$TAKEOVER_CHAN_ID' AND type = 'talk';")
if [ "$TAKEOVER_TALK" = "0" ]; then
  fail "the takeover produced no conversation at all"
fi
echo "  ✓ no topic aired twice across the takeover ($TAKEOVER_TALK conversation(s) from the survivor)"

req POST "$MOCKS_URL/__control" -H "Content-Type: application/json" -d '{"mode":"normal","delayMs":0}'
