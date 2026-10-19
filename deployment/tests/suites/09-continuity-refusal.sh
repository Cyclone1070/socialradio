#!/bin/sh
set -e

. /scripts/lib/common.sh

TOKEN=$(get_admin_token)
MOCKS_URL="${LLM_STUB_URL:-http://mocks:4010}"
ensure_base_fixtures

echo ""
echo "=== Section 9: Refusing a conversation that contradicts the show ==="

# The stub can be told to answer with the wrong opening. The app is supposed to
# notice, re-ask once, and retire the topic rather than air the contradiction -
# which is only observable from outside if something can make the model misbehave.
req POST "$MOCKS_URL/__control" -H "Content-Type: application/json" -d '{"mode":"contradict"}'
if [ "$STATUS" != "200" ]; then
  fail "could not put the model stub into contradict mode (HTTP $STATUS)"
fi
echo "  ✓ model stub told to answer with the wrong opening"

psql_run -c "
  DELETE FROM channel_post_progress;
  DELETE FROM comment;
  DELETE FROM post;
" >/dev/null
psql_run -f /scripts/fixtures/ai-talk.sql >/dev/null || fail "ai-talk.sql fixture failed"

assert_status POST "$BASE_URL/channels" 201 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Continuity Refusal Radio","visibility":"public"}'
REFUSAL_CHAN_ID=$(echo "$BODY" | jq -r '.id')
[ -n "$REFUSAL_CHAN_ID" ] && [ "$REFUSAL_CHAN_ID" != "null" ] || fail "failed to extract REFUSAL_CHAN_ID"

assert_status POST "$BASE_URL/channels/$REFUSAL_CHAN_ID/subreddits" 201 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subredditName":"ai_talk_fixture_sub_e2e"}'

echo "60. A cold start against a contradicting model still serves the station"
assert_status GET "$BASE_URL/channels/$REFUSAL_CHAN_ID/live.m3u8" 200
if ! echo "$BODY" | grep -q '#EXT-X-VERSION:3'; then
  fail "the station served a malformed manifest while the model was misbehaving"
fi
echo "  ✓ the request was answered while the run was still deciding"

# The run does its work in the background; give it room to be refused twice.
ATTEMPTS=0
while [ "$ATTEMPTS" -lt 20 ]; do
  TALK_ROWS=$(psql_run -t -A -c "SELECT COUNT(*) FROM segment WHERE \"channel_id\" = '$REFUSAL_CHAN_ID' AND type = 'talk';")
  RETIRED=$(psql_run -t -A -c "SELECT COUNT(*) FROM channel_post_progress WHERE \"channel_id\" = '$REFUSAL_CHAN_ID';")
  if [ "$RETIRED" != "0" ]; then break; fi
  ATTEMPTS=$((ATTEMPTS + 1))
  sleep 1
done

echo "61. The contradicting conversation never aired, and its topic was retired"
if [ "$TALK_ROWS" != "0" ]; then
  fail "a conversation that contradicted the show was aired anyway ($TALK_ROWS talk row(s))"
fi
echo "  ✓ no conversation aired"
if [ "$RETIRED" = "0" ]; then
  fail "the contradicting topic was neither aired nor retired - it is stuck and will be retried forever"
fi
echo "  ✓ the topic was retired ($RETIRED post row(s)), so it is not picked again"

# And the station is not stuck in refusal mode: with an obedient model the next
# station generates normally.
req POST "$MOCKS_URL/__control" -H "Content-Type: application/json" -d '{"mode":"normal"}'
if [ "$STATUS" != "200" ]; then
  fail "could not put the model stub back to normal (HTTP $STATUS)"
fi
psql_run -f /scripts/fixtures/ai-talk.sql >/dev/null || fail "ai-talk.sql fixture failed on the second pass"
assert_status POST "$BASE_URL/channels" 201 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Continuity Recovery Radio","visibility":"public"}'
RECOVERY_CHAN_ID=$(echo "$BODY" | jq -r '.id')
assert_status POST "$BASE_URL/channels/$RECOVERY_CHAN_ID/subreddits" 201 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subredditName":"ai_talk_fixture_sub_e2e"}'
req GET "$BASE_URL/channels/$RECOVERY_CHAN_ID/live.m3u8"

ATTEMPTS=0
RECOVERED="0"
while [ "$ATTEMPTS" -lt 20 ]; do
  RECOVERED=$(psql_run -t -A -c "SELECT COUNT(*) FROM segment WHERE \"channel_id\" = '$RECOVERY_CHAN_ID' AND type = 'talk';")
  if [ "$RECOVERED" != "0" ]; then break; fi
  ATTEMPTS=$((ATTEMPTS + 1))
  sleep 1
done
if [ "$RECOVERED" = "0" ]; then
  fail "an obedient model produced no conversation after a refusal - the refusal path poisons the channel"
fi
echo "  ✓ an obedient model generates normally again ($RECOVERED conversation(s))"
