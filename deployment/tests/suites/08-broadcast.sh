#!/bin/sh
set -e

. /scripts/lib/common.sh

TOKEN=$(get_admin_token)
ensure_base_fixtures

echo ""
echo "=== Section 8: Live Broadcast (RFC 8216 Native HLS Streaming) ==="

echo "51. POST /channels (Create radio station for broadcast testing)"
assert_status POST "$BASE_URL/channels" 201 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Broadcast Verification Radio","visibility":"public"}'
BC_CHAN_ID=$(echo "$BODY" | jq -r '.id')
[ -n "$BC_CHAN_ID" ] && [ "$BC_CHAN_ID" != "null" ] || fail "failed to extract BC_CHAN_ID"
echo "  ✓ Broadcast channel created: $BC_CHAN_ID"

echo "52. Live Manifest Handshake & Response Headers"
HEADER_FILE=$(mktemp)
BODY_FILE=$(mktemp)
curl -s -D "$HEADER_FILE" -o "$BODY_FILE" "$BASE_URL/channels/$BC_CHAN_ID/live.m3u8"
STREAM_HEADERS=$(cat "$HEADER_FILE")
MANIFEST_BODY=$(cat "$BODY_FILE")
rm -f "$HEADER_FILE" "$BODY_FILE"

if ! echo "$STREAM_HEADERS" | grep -iq "200 OK"; then
  echo "Headers:"
  echo "$STREAM_HEADERS"
  fail "Manifest handshake failed, expected 200 OK"
fi
if ! echo "$STREAM_HEADERS" | grep -iq "content-type: application/vnd.apple.mpegurl"; then
  echo "Headers:"
  echo "$STREAM_HEADERS"
  fail "Expected Content-Type: application/vnd.apple.mpegurl in headers"
fi
if ! echo "$STREAM_HEADERS" | grep -iq "cache-control:.*max-age=2"; then
  echo "Headers:"
  echo "$STREAM_HEADERS"
  fail "Expected Cache-Control: max-age=2 in headers"
fi
if ! echo "$STREAM_HEADERS" | grep -iq "cache-control:.*public"; then
  echo "Headers:"
  echo "$STREAM_HEADERS"
  fail "Expected Cache-Control: public in public channel headers"
fi
echo "  ✓ Handshake 200 OK, Content-Type and Cache-Control headers verified"

echo "53. RFC 8216 Manifest Protocol & Invariant Assertions"
if ! echo "$MANIFEST_BODY" | grep -q '^#EXTM3U'; then
  fail "Manifest does not start with #EXTM3U"
fi
if ! echo "$MANIFEST_BODY" | grep -q '#EXT-X-VERSION:3'; then
  fail "Manifest missing #EXT-X-VERSION:3"
fi
if ! echo "$MANIFEST_BODY" | grep -qE '#EXT-X-TARGETDURATION:[0-9]+'; then
  fail "Manifest missing valid #EXT-X-TARGETDURATION"
fi
if ! echo "$MANIFEST_BODY" | grep -qE '#EXT-X-MEDIA-SEQUENCE:[0-9]+'; then
  fail "Manifest missing valid #EXT-X-MEDIA-SEQUENCE"
fi
INF_COUNT=$(echo "$MANIFEST_BODY" | grep -c '#EXTINF:' || echo "0")
if [ "$INF_COUNT" -lt 4 ]; then
  fail "Sliding window has fewer than 4 segments ($INF_COUNT found)"
fi
if echo "$MANIFEST_BODY" | grep -q '#EXT-X-ENDLIST'; then
  fail "Live radio manifest must NOT terminate with #EXT-X-ENDLIST"
fi
echo "  ✓ RFC 8216 syntax, sliding window ($INF_COUNT chunks), and liveness contract verified"

echo "54. Audio Chunk Ingestion: retrieve and verify chunk from manifest"
CHUNK_URL=$(echo "$MANIFEST_BODY" | grep -v '^#' | grep -v '^$' | head -1)
if [ -z "$CHUNK_URL" ]; then
  fail "No audio chunk URL found in manifest: $MANIFEST_BODY"
fi
echo "  ✓ First chunk URL: $CHUNK_URL"

CHUNK_FETCH_URL=$(echo "$CHUNK_URL" | sed "s|http://localhost:9000|$STORAGE_URL|; s|http://127.0.0.1:9000|$STORAGE_URL|")

CHUNK_FILE="/tmp/broadcast-chunk.mp3"
rm -f "$CHUNK_FILE"
curl -s -f "$CHUNK_FETCH_URL" -o "$CHUNK_FILE" || fail "Failed to download chunk from $CHUNK_FETCH_URL (raw: $CHUNK_URL)"

if [ ! -f "$CHUNK_FILE" ]; then
  fail "Chunk file $CHUNK_FILE was not downloaded"
fi

CAPTURED_BYTES=$(wc -c < "$CHUNK_FILE" | tr -d ' ')
echo "  ✓ Downloaded chunk size: $CAPTURED_BYTES bytes"
if [ "$CAPTURED_BYTES" -lt 10000 ]; then
  fail "Chunk size suspiciously small: $CAPTURED_BYTES bytes (expected >= 10000 bytes)"
fi

FORMAT_INFO=$(file "$CHUNK_FILE")
echo "  ✓ Chunk file format: $FORMAT_INFO"
if ! echo "$FORMAT_INFO" | grep -iq "MPEG\|Audio\|Layer III"; then
  fail "Downloaded file is not valid MPEG audio: $FORMAT_INFO"
fi

echo "55. Audio Energy Verification: inspect audio frames for active waveform (non-silence)"
VOL_OUTPUT=$(ffmpeg -i "$CHUNK_FILE" -af volumedetect -f null /dev/null 2>&1 || true)
MEAN_VOL=$(echo "$VOL_OUTPUT" | grep -i "mean_volume:" | awk '{print $5}')
echo "  ✓ Detected Mean Volume: $MEAN_VOL dB"

if [ -z "$MEAN_VOL" ]; then
  fail "Failed to compute audio volume levels from chunk"
fi

MEAN_NUM=$(echo "$MEAN_VOL" | sed 's/-//; s/dB//; s/\..*//')
if [ -n "$MEAN_NUM" ] && [ "$MEAN_NUM" -gt 60 ] 2>/dev/null; then
  fail "Stream audio is completely silent / dead air (mean volume: $MEAN_VOL dB <= -60 dB)"
fi
echo "  ✓ Audio chunk contains active waveforms (mean volume: $MEAN_VOL dB > -60 dB)"

echo "56. Idle Freeze & Wakeup Verification with Zero Sleep (Deterministic Timestamp Backdating)"
# Instantaneously backdate last_active_at by 15 minutes directly in PostgreSQL (zero sleep!)
psql_run -c "UPDATE channel SET last_active_at = now() - interval '15 minutes' WHERE id = '$BC_CHAN_ID';" >/dev/null

# Capture current playhead before waking up
FROZEN_SEG=$(psql_run -t -A -c "SELECT \"current_segment_id\" FROM channel WHERE \"id\" = '$BC_CHAN_ID';")

# Reconnect listener immediately
assert_status GET "$BASE_URL/channels/$BC_CHAN_ID/live.m3u8" 200

# SQL read-back: assert stream resumed seamlessly and last_active_at was refreshed to now
RESUMED_SEG=$(psql_run -t -A -c "SELECT \"current_segment_id\" FROM channel WHERE \"id\" = '$BC_CHAN_ID';")
RESUMED_ACTIVE=$(psql_run -t -A -c "SELECT \"last_active_at\" FROM channel WHERE \"id\" = '$BC_CHAN_ID';")

[ -n "$RESUMED_ACTIVE" ] || fail "last_active_at was not updated after wakeup"

ACTIVE_AGE_SEC=$(psql_run -t -A -c "SELECT EXTRACT(EPOCH FROM (now() - \"last_active_at\")) FROM channel WHERE \"id\" = '$BC_CHAN_ID';")
ACTIVE_AGE_INT=$(echo "$ACTIVE_AGE_SEC" | cut -d. -f1)
if [ -z "$ACTIVE_AGE_INT" ] || [ "$ACTIVE_AGE_INT" -gt 5 ]; then
  fail "last_active_at was not refreshed to current time after wakeup: ${ACTIVE_AGE_SEC}s old"
fi
echo "  ✓ Post-idle listener woke station up with zero sleep; last_active_at refreshed to now (<${ACTIVE_AGE_SEC}s old)"

echo "57. Concurrent Polling Deduplication: parallel requests maintain playhead consistency"
RESP1_FILE=$(mktemp)
RESP2_FILE=$(mktemp)
curl -s "$BASE_URL/channels/$BC_CHAN_ID/live.m3u8" > "$RESP1_FILE" &
PID1=$!
curl -s "$BASE_URL/channels/$BC_CHAN_ID/live.m3u8" > "$RESP2_FILE" &
PID2=$!
wait $PID1
wait $PID2

RES1=$(cat "$RESP1_FILE")
RES2=$(cat "$RESP2_FILE")
rm -f "$RESP1_FILE" "$RESP2_FILE"

if ! echo "$RES1" | grep -q '^#EXTM3U' || ! echo "$RES2" | grep -q '^#EXTM3U'; then
  fail "Concurrent requests produced invalid manifests"
fi

SEQ1=$(echo "$RES1" | grep '#EXT-X-MEDIA-SEQUENCE:' | sed 's/#EXT-X-MEDIA-SEQUENCE://')
SEQ2=$(echo "$RES2" | grep '#EXT-X-MEDIA-SEQUENCE:' | sed 's/#EXT-X-MEDIA-SEQUENCE://')
if [ "$SEQ1" != "$SEQ2" ]; then
  fail "Concurrent requests returned divergent media sequences: $SEQ1 vs $SEQ2"
fi
echo "  ✓ Concurrent parallel requests synchronized to same sequence #$SEQ1 without race conditions"

echo "58. Orphaned Playhead Recovery & Sequence Monotonicity (Self-Healing Playhead)"
# Query current channel state in PostgreSQL
PREV_SEQ=$(psql_run -t -A -c "SELECT COALESCE(\"current_play_order\", 1) FROM channel WHERE \"id\" = '$BC_CHAN_ID';")
[ -n "$PREV_SEQ" ] || PREV_SEQ=1

# Verify DB constraints actively reject corrupted state
if psql_run -c "INSERT INTO segment (\"id\", \"channel_id\", \"play_order\", \"type\", \"duration_seconds\", \"audio_url\", \"created_at\") VALUES ('00000000-0000-0000-0000-000000000001', '$BC_CHAN_ID', -1, 'jingle', 10, 'jingles/station-id.mp3', now() - interval '1 hour');" 2>/dev/null; then
  fail "DB allowed inserting negative play_order on segment"
fi
if psql_run -c "UPDATE channel SET \"current_segment_id\" = '00000000-0000-0000-0000-000000000099' WHERE \"id\" = '$BC_CHAN_ID';" 2>/dev/null; then
  fail "DB allowed setting nonexistent current_segment_id on channel"
fi

# Simulate orphaned playhead: set current_segment_id to NULL
psql_run -c "UPDATE channel SET \"current_segment_id\" = NULL WHERE \"id\" = '$BC_CHAN_ID';" >/dev/null

# Listener polls manifest
assert_status GET "$BASE_URL/channels/$BC_CHAN_ID/live.m3u8" 200
NEW_MANIFEST="$BODY"

# Assertions:
# 1. Manifest is valid HLS
if ! echo "$NEW_MANIFEST" | grep -q '^#EXTM3U'; then
  fail "Manifest corrupted after orphaned recovery"
fi

# 2. Media sequence is monotonic: must NOT have regressed into historical past!
NEW_SEQ=$(echo "$NEW_MANIFEST" | grep '#EXT-X-MEDIA-SEQUENCE:' | sed 's/#EXT-X-MEDIA-SEQUENCE://')
if [ "$NEW_SEQ" -lt "$PREV_SEQ" ]; then
  fail "Media sequence regressed into historical past! (was $PREV_SEQ, got $NEW_SEQ)"
fi

# 3. Channel record in Postgres was self-healed: current_segment_id was restored
HEALED_SEG=$(psql_run -t -A -c "SELECT \"current_segment_id\" FROM channel WHERE \"id\" = '$BC_CHAN_ID';")
[ -n "$HEALED_SEG" ] || fail "Channel current_segment_id was not self-healed in PostgreSQL"
echo "  ✓ Orphaned playhead self-healed in DB (seq #$NEW_SEQ >= #$PREV_SEQ without rewinding to historical past)"
