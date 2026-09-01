#!/bin/sh
set -e

. /scripts/lib/common.sh

TOKEN=$(get_admin_token)
ensure_base_fixtures

echo ""
echo "=== Section 5: Playback, Idle & Queue Safety ==="

echo "34. POST /channels (Create fresh channel for playback tests)"
assert_status POST "$BASE_URL/channels" 201 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Playback Test Radio","visibility":"public"}'
PLAY_CHAN_ID=$(echo "$BODY" | jq -r '.id')
[ -n "$PLAY_CHAN_ID" ] && [ "$PLAY_CHAN_ID" != "null" ] || fail "failed to extract PLAY_CHAN_ID"
echo "  ✓ Playback channel created: $PLAY_CHAN_ID"

echo "35. GET /channels/$PLAY_CHAN_ID/next-track (Cold start -> bufferAhead generates batch & returns Track #1)"
assert_status GET "$BASE_URL/channels/$PLAY_CHAN_ID/next-track" 200 \
  -H "x-internal-token: $SECRET"
assert_jq '.segmentId | type == "string" and length > 0' 'segmentId present'
assert_jq '.type | type == "string" and length > 0' 'type present'
assert_jq '.filePath | type == "string" and length > 0' 'filePath present'
assert_jq '.durationSeconds | type == "number" and . >= 0' 'durationSeconds is valid'
FIRST_SEGMENT_ID=$(echo "$BODY" | jq -r '.segmentId')

echo "36. SQL read-back: assert currentSegmentId updated in channel table"
CURRENT_DB_SEG=$(psql_run -t -A -c "SELECT \"current_segment_id\" FROM channel WHERE \"id\" = '$PLAY_CHAN_ID';")
if [ "$CURRENT_DB_SEG" != "$FIRST_SEGMENT_ID" ]; then
  fail "channel current_segment_id in DB ($CURRENT_DB_SEG) does not match returned segmentId ($FIRST_SEGMENT_ID)"
fi
echo "  ✓ channel playhead updated in DB ($CURRENT_DB_SEG)"

echo "37. GET /channels/$PLAY_CHAN_ID/next-track (Normal sequential next track -> FIFO progression)"
assert_status GET "$BASE_URL/channels/$PLAY_CHAN_ID/next-track" 200 \
  -H "x-internal-token: $SECRET"
assert_jq ".segmentId != \"$FIRST_SEGMENT_ID\"" 'advances to next segment in queue'
SECOND_SEGMENT_ID=$(echo "$BODY" | jq -r '.segmentId')

echo "37b. SQL read-back: assert FIFO playOrder strictly increased"
FIRST_ORDER=$(psql_run -t -A -c "SELECT \"play_order\" FROM segment WHERE \"id\" = '$FIRST_SEGMENT_ID';")
SECOND_ORDER=$(psql_run -t -A -c "SELECT \"play_order\" FROM segment WHERE \"id\" = '$SECOND_SEGMENT_ID';")
if [ "$SECOND_ORDER" -le "$FIRST_ORDER" ]; then
  fail "play_order did not increase: first=$FIRST_ORDER, second=$SECOND_ORDER"
fi
echo "  ✓ FIFO playOrder advanced: #$FIRST_ORDER -> #$SECOND_ORDER"

echo "38. Internal Token Auth Negatives on /channels/:id/next-track"
assert_status GET "$BASE_URL/channels/$PLAY_CHAN_ID/next-track" 401
assert_jq '.message' 'body confirms 401 without token'

assert_status GET "$BASE_URL/channels/$PLAY_CHAN_ID/next-track" 401 \
  -H "x-internal-token: wrong-token-123"
assert_jq '.message' 'body confirms 401 with wrong token'

echo "38b. GET /channels/000.../next-track (Fake UUID -> 404)"
assert_status GET "$BASE_URL/channels/00000000-0000-0000-0000-000000000000/next-track" 404 \
  -H "x-internal-token: $SECRET"
assert_jq '.message == "Channel not found"' '404 message'
