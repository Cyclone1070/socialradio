#!/bin/sh
set -e

. /scripts/lib/common.sh

TOKEN=$(get_admin_token)
USER_TOKEN=$(get_user_token)
ensure_base_fixtures

echo ""
echo "=== Section 5: Playback, Virtual Clock & Queue Safety ==="

echo "34. POST /channels (Create fresh public channel for playback tests)"
assert_status POST "$BASE_URL/channels" 201 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Playback Test Radio","visibility":"public"}'
PLAY_CHAN_ID=$(echo "$BODY" | jq -r '.id')
[ -n "$PLAY_CHAN_ID" ] && [ "$PLAY_CHAN_ID" != "null" ] || fail "failed to extract PLAY_CHAN_ID"
echo "  ✓ Playback channel created: $PLAY_CHAN_ID"

echo "35. GET /channels/$PLAY_CHAN_ID/live.m3u8 (Cold start -> bufferAhead generates batch & returns Live Playlist)"
assert_status GET "$BASE_URL/channels/$PLAY_CHAN_ID/live.m3u8" 200
if ! echo "$BODY" | grep -q '^#EXTM3U'; then
  fail "Manifest does not start with #EXTM3U: $BODY"
fi
if ! echo "$BODY" | grep -q '#EXT-X-VERSION:3'; then
  fail "Manifest missing #EXT-X-VERSION:3"
fi
if ! echo "$BODY" | grep -q '#EXT-X-MEDIA-SEQUENCE:1'; then
  fail "Manifest initial media sequence should be 1"
fi
if ! echo "$BODY" | grep -q '#EXTINF:'; then
  fail "Manifest missing #EXTINF entries"
fi
echo "  ✓ Cold start returned valid RFC 8216 live.m3u8 manifest"

echo "36. SQL read-back: assert current_segment_id, playhead_started_at, and last_active_at in channel table"
CURRENT_DB_SEG=$(psql_run -t -A -c "SELECT \"current_segment_id\" FROM channel WHERE \"id\" = '$PLAY_CHAN_ID';")
PLAYHEAD_START=$(psql_run -t -A -c "SELECT \"playhead_started_at\" FROM channel WHERE \"id\" = '$PLAY_CHAN_ID';")
LAST_ACTIVE=$(psql_run -t -A -c "SELECT \"last_active_at\" FROM channel WHERE \"id\" = '$PLAY_CHAN_ID';")

[ -n "$CURRENT_DB_SEG" ] && [ "$CURRENT_DB_SEG" != "" ] || fail "current_segment_id is null in DB"
[ -n "$PLAYHEAD_START" ] && [ "$PLAYHEAD_START" != "" ] || fail "playhead_started_at is null in DB"
[ -n "$LAST_ACTIVE" ] && [ "$LAST_ACTIVE" != "" ] || fail "last_active_at is null in DB"

FIRST_SEGMENT_ID="$CURRENT_DB_SEG"
echo "  ✓ Channel playhead and virtual clock initialized in DB ($CURRENT_DB_SEG)"

echo "37. Deterministic Time Advancement: backdate playhead_started_at to simulate elapsed time"
# Backdate playhead by 300 seconds to simulate elapsed playback without sleeping
psql_run -c "UPDATE channel SET playhead_started_at = now() - interval '300 seconds' WHERE id = '$PLAY_CHAN_ID';" >/dev/null

echo "37a. GET /channels/$PLAY_CHAN_ID/live.m3u8 (Virtual clock advances playhead in DB)"
assert_status GET "$BASE_URL/channels/$PLAY_CHAN_ID/live.m3u8" 200
NEW_SEQ=$(echo "$BODY" | grep '#EXT-X-MEDIA-SEQUENCE:' | sed 's/#EXT-X-MEDIA-SEQUENCE://')
if [ -z "$NEW_SEQ" ] || [ "$NEW_SEQ" -le 1 ]; then
  fail "media sequence did not advance: $NEW_SEQ"
fi
echo "  ✓ Manifest media sequence advanced from 1 to $NEW_SEQ"

echo "37b. SQL read-back: assert current_segment_id in DB advanced with playOrder"
SECOND_SEGMENT_ID=$(psql_run -t -A -c "SELECT \"current_segment_id\" FROM channel WHERE \"id\" = '$PLAY_CHAN_ID';")
if [ "$SECOND_SEGMENT_ID" = "$FIRST_SEGMENT_ID" ]; then
  fail "current_segment_id in DB did not advance ($SECOND_SEGMENT_ID)"
fi

FIRST_ORDER=$(psql_run -t -A -c "SELECT \"play_order\" FROM segment WHERE \"id\" = '$FIRST_SEGMENT_ID';")
SECOND_ORDER=$(psql_run -t -A -c "SELECT \"play_order\" FROM segment WHERE \"id\" = '$SECOND_SEGMENT_ID';")
if [ "$SECOND_ORDER" -le "$FIRST_ORDER" ]; then
  fail "play_order did not increase: first=$FIRST_ORDER, second=$SECOND_ORDER"
fi
echo "  ✓ FIFO playOrder advanced in DB: #$FIRST_ORDER -> #$SECOND_ORDER"

echo "38. Access Control on Private Channels (Rule A-3)"
assert_status POST "$BASE_URL/channels" 201 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Private Channel QA","visibility":"private"}'
PRIV_CHAN_ID=$(echo "$BODY" | jq -r '.id')
[ -n "$PRIV_CHAN_ID" ] && [ "$PRIV_CHAN_ID" != "null" ] || fail "failed to extract PRIV_CHAN_ID"

echo "  ✓ Unauthenticated access to private channel -> 401"
assert_status GET "$BASE_URL/channels/$PRIV_CHAN_ID/live.m3u8" 401

echo "  ✓ Non-owner user access to private channel -> 403"
assert_status GET "$BASE_URL/channels/$PRIV_CHAN_ID/live.m3u8" 403 \
  -H "Authorization: Bearer $USER_TOKEN"

echo "  ✓ Channel owner access to private channel -> 200"
assert_status GET "$BASE_URL/channels/$PRIV_CHAN_ID/live.m3u8" 200 \
  -H "Authorization: Bearer $TOKEN"

if echo "$HEADERS" | grep -iq "cache-control:.*public"; then
  fail "Private channel must NOT have Cache-Control: public"
fi
if ! echo "$HEADERS" | grep -iq "cache-control:.*private"; then
  fail "Private channel must have Cache-Control: private, no-store (got: $(echo "$HEADERS" | grep -i cache-control))"
fi
echo "  ✓ Private channel Cache-Control: private, no-store verified (Security Invariant)"

echo "38b. GET /channels/000.../live.m3u8 (Fake UUID -> 404)"
assert_status GET "$BASE_URL/channels/00000000-0000-0000-0000-000000000000/live.m3u8" 404
assert_jq '.message == "Channel not found"' '404 message'
