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

echo "37c. Issue 1: Missing audio segment in window must not desync MEDIA-SEQUENCE"
psql_run -c "UPDATE segment SET audio_url = '' WHERE id = '$SECOND_SEGMENT_ID';" >/dev/null
assert_status GET "$BASE_URL/channels/$PLAY_CHAN_ID/live.m3u8" 200
DROPPED_SEQ=$(echo "$BODY" | grep '#EXT-X-MEDIA-SEQUENCE:' | sed 's/#EXT-X-MEDIA-SEQUENCE://')
FIRST_CHUNK_ORDER=$(psql_run -t -A -c "SELECT \"play_order\" FROM segment WHERE \"channel_id\" = '$PLAY_CHAN_ID' AND \"audio_url\" != '' AND \"play_order\" >= '$SECOND_ORDER' ORDER BY \"play_order\" ASC LIMIT 1;")
if [ "$DROPPED_SEQ" -ne "$FIRST_CHUNK_ORDER" ]; then
  fail "MEDIA-SEQUENCE ($DROPPED_SEQ) does not match first playable chunk play_order ($FIRST_CHUNK_ORDER)"
fi
echo "  ✓ MEDIA-SEQUENCE matches first playable chunk ($DROPPED_SEQ = $FIRST_CHUNK_ORDER)"

echo "37d. Issue 2: Established channel with missing playhead_started_at must not rewind to track 1"
psql_run -c "UPDATE channel SET playhead_started_at = NULL WHERE id = '$PLAY_CHAN_ID';" >/dev/null
assert_status GET "$BASE_URL/channels/$PLAY_CHAN_ID/live.m3u8" 200
REWOUND_SEQ=$(echo "$BODY" | grep '#EXT-X-MEDIA-SEQUENCE:' | sed 's/#EXT-X-MEDIA-SEQUENCE://')
if [ "$REWOUND_SEQ" -lt "$SECOND_ORDER" ]; then
  fail "Station time-traveled back to $REWOUND_SEQ (expected >= $SECOND_ORDER)"
fi
echo "  ✓ Station resumed without time-travel ($REWOUND_SEQ >= $SECOND_ORDER)"

echo "37e. Issue 3: Missing last_active_at on active quiet station must trigger idle freeze"
psql_run -c "UPDATE channel SET last_active_at = NULL, playhead_started_at = now() - interval '3600 seconds' WHERE id = '$PLAY_CHAN_ID';" >/dev/null
assert_status GET "$BASE_URL/channels/$PLAY_CHAN_ID/live.m3u8" 200
LAST_ACTIVE_AFTER=$(psql_run -t -A -c "SELECT \"last_active_at\" FROM channel WHERE id = '$PLAY_CHAN_ID';")
[ -n "$LAST_ACTIVE_AFTER" ] || fail "last_active_at was not set after wakeup"
FROZEN_SEQ=$(echo "$BODY" | grep '#EXT-X-MEDIA-SEQUENCE:' | sed 's/#EXT-X-MEDIA-SEQUENCE://')
if [ "$FROZEN_SEQ" -gt 35 ]; then
  fail "Idle freeze failed: sequence jumped to $FROZEN_SEQ (burned > 600s of queue)"
fi
echo "  ✓ Idle freeze safely clamped advancement (sequence: #$FROZEN_SEQ <= 35)"

echo "37f. Issue 4: DB constraints reject negative duration and null audio_url"
ACTIVE_SEG_ID=$(psql_run -t -A -c "SELECT id FROM segment WHERE \"channel_id\" = '$PLAY_CHAN_ID' AND \"play_order\" >= '$FROZEN_SEQ' ORDER BY \"play_order\" ASC LIMIT 1;")
if psql_run -c "UPDATE segment SET duration_seconds = -1 WHERE id = '$ACTIVE_SEG_ID';" 2>/dev/null; then
  fail "DB allowed setting negative duration_seconds on segment"
fi
echo "  ✓ DB check constraint rejected negative duration_seconds"

if psql_run -c "UPDATE segment SET duration_seconds = 99999 WHERE id = '$ACTIVE_SEG_ID';" 2>/dev/null; then
  fail "DB allowed setting excessive duration_seconds (> 7200s) on segment"
fi
echo "  ✓ DB check constraint rejected excessive duration_seconds (> 7200s)"

if psql_run -c "UPDATE segment SET audio_url = NULL WHERE id = '$ACTIVE_SEG_ID';" 2>/dev/null; then
  fail "DB allowed setting NULL audio_url on segment"
fi
echo "  ✓ DB NOT NULL constraint rejected NULL audio_url"

if psql_run -c "INSERT INTO segment (id, \"channel_id\", play_order, type, duration_seconds, audio_url) VALUES (gen_random_uuid(), '$PLAY_CHAN_ID', 0, 'jingle', 10, 'jingles/id.mp3');" 2>/dev/null; then
  fail "DB allowed inserting play_order = 0 on segment"
fi
if psql_run -c "INSERT INTO segment (id, \"channel_id\", play_order, type, duration_seconds, audio_url) VALUES (gen_random_uuid(), '$PLAY_CHAN_ID', -5, 'jingle', 10, 'jingles/id.mp3');" 2>/dev/null; then
  fail "DB allowed inserting negative play_order on segment"
fi
echo "  ✓ DB check constraint rejected non-positive play_order (<= 0)"

if psql_run -c "INSERT INTO segment (id, \"channel_id\", play_order, type, duration_seconds, audio_url, status) VALUES (gen_random_uuid(), '$PLAY_CHAN_ID', 9999, 'jingle', 10, 'jingles/id.mp3', 'bogus');" 2>/dev/null; then
  fail "DB allowed invalid segment status 'bogus'"
fi
echo "  ✓ DB check constraint rejected invalid segment status"

if psql_run -c "INSERT INTO segment (id, \"channel_id\", play_order, type, duration_seconds, audio_url, title, artist) VALUES (gen_random_uuid(), '$PLAY_CHAN_ID', 9998, 'music', 120, 'music/track.mp3', NULL, 'Artist');" 2>/dev/null; then
  fail "DB allowed music segment with NULL title"
fi
if psql_run -c "INSERT INTO segment (id, \"channel_id\", play_order, type, duration_seconds, audio_url, title, artist) VALUES (gen_random_uuid(), '$PLAY_CHAN_ID', 9997, 'music', 120, 'music/track.mp3', 'Title', NULL);" 2>/dev/null; then
  fail "DB allowed music segment with NULL artist"
fi
echo "  ✓ DB check constraint rejected music segment with missing title/artist"

if psql_run -c "INSERT INTO segment (id, \"channel_id\", play_order, type, duration_seconds, audio_url, cluster_id) VALUES (gen_random_uuid(), '$PLAY_CHAN_ID', 9996, 'talk', 60, 'talk/track.mp3', NULL);" 2>/dev/null; then
  fail "DB allowed talk segment with NULL cluster_id"
fi
echo "  ✓ DB check constraint rejected talk segment with missing cluster_id"

echo "37g. Issue 5: Concurrent manifest requests must not deadlock or fail"
PIDS=""
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -w "%{http_code}\n" "$BASE_URL/channels/$PLAY_CHAN_ID/live.m3u8" > "/tmp/concurrent_test_$i.txt" &
  PIDS="$PIDS $!"
done
for pid in $PIDS; do
  wait "$pid"
done
for i in 1 2 3 4 5; do
  CODE=$(cat "/tmp/concurrent_test_$i.txt")
  rm -f "/tmp/concurrent_test_$i.txt"
  if [ "$CODE" != "200" ]; then
    fail "Concurrent manifest request #$i failed with status $CODE"
  fi
done
echo "  ✓ Concurrent manifest requests resolved cleanly without lock contention"

echo "37h. Issue 6: Channel FK integrity (current_segment_id, owner_id) & self-healing playhead"
if psql_run -c "UPDATE channel SET current_segment_id = '00000000-0000-0000-0000-000000000000' WHERE id = '$PLAY_CHAN_ID';" 2>/dev/null; then
  fail "DB allowed setting nonexistent current_segment_id on channel"
fi
echo "  ✓ DB FK rejected nonexistent current_segment_id"

if psql_run -c "UPDATE channel SET owner_id = '00000000-0000-0000-0000-000000000000' WHERE id = '$PLAY_CHAN_ID';" 2>/dev/null; then
  fail "DB allowed setting nonexistent owner_id on channel"
fi
echo "  ✓ DB FK rejected nonexistent owner_id"

CHAN_CURR_SEG=$(psql_run -t -A -c "SELECT current_segment_id FROM channel WHERE id = '$PLAY_CHAN_ID';")
if [ -n "$CHAN_CURR_SEG" ] && [ "$CHAN_CURR_SEG" != "" ]; then
  psql_run -c "DELETE FROM segment WHERE id = '$CHAN_CURR_SEG';" >/dev/null
  CHAN_SEG_AFTER_DEL=$(psql_run -t -A -c "SELECT current_segment_id FROM channel WHERE id = '$PLAY_CHAN_ID';")
  [ -z "$CHAN_SEG_AFTER_DEL" ] || fail "ON DELETE SET NULL failed: current_segment_id still set to $CHAN_SEG_AFTER_DEL"
  echo "  ✓ ON DELETE SET NULL automatically nulled channel.current_segment_id upon segment deletion"

  assert_status GET "$BASE_URL/channels/$PLAY_CHAN_ID/live.m3u8" 200
  CHAN_SEG_HEALED=$(psql_run -t -A -c "SELECT current_segment_id FROM channel WHERE id = '$PLAY_CHAN_ID';")
  [ -n "$CHAN_SEG_HEALED" ] && [ "$CHAN_SEG_HEALED" != "" ] || fail "Playback service failed to self-heal current_segment_id"
  echo "  ✓ Playback service self-healed current_segment_id ($CHAN_SEG_HEALED)"
fi

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
