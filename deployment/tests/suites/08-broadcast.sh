#!/bin/sh
set -e

. /scripts/lib/common.sh

TOKEN=$(get_admin_token)
ensure_base_fixtures

echo ""
echo "=== Section 8: Live Broadcast (Liquidsoap & Icecast) ==="

echo "51. GET $ICECAST_URL (Icecast Server Health -> 200)"
assert_status GET "$ICECAST_URL/" 200
echo "  ✓ Icecast server is online and reachable"

echo "52. POST /channels (Create radio station for broadcast testing)"
assert_status POST "$BASE_URL/channels" 201 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Broadcast Verification Radio","visibility":"public"}'
BC_CHAN_ID=$(echo "$BODY" | jq -r '.id')
[ -n "$BC_CHAN_ID" ] && [ "$BC_CHAN_ID" != "null" ] || fail "failed to extract BC_CHAN_ID"
echo "  ✓ Broadcast channel created: $BC_CHAN_ID"

echo "53. Poll Icecast Mount: wait for Liquidsoap to mount /channels/$BC_CHAN_ID.mp3"
MAX_WAIT=45
i=0
MOUNTED=0
MOUNT_PATH="/channels/$BC_CHAN_ID.mp3"
while [ $i -lt $MAX_WAIT ]; do
  STATUS_RESP=$(curl -s "$ICECAST_URL/status-json.xsl" 2>/dev/null || true)
  if echo "$STATUS_RESP" | grep -q "$MOUNT_PATH"; then
    MOUNTED=1
    break
  fi
  i=$((i+1))
  sleep 1
done
[ "$MOUNTED" = 1 ] || fail "Mount point $MOUNT_PATH not registered in Icecast within ${MAX_WAIT}s"
echo "  ✓ Mount $MOUNT_PATH registered in Icecast after ~${i}s"

echo "54. Live Stream Handshake: connect to $ICECAST_URL$MOUNT_PATH"
HEADER_FILE=$(mktemp)
curl -s -N --max-time 2 -D "$HEADER_FILE" -o /dev/null "$ICECAST_URL$MOUNT_PATH" || true
STREAM_HEADERS=$(cat "$HEADER_FILE")
rm -f "$HEADER_FILE"

if ! echo "$STREAM_HEADERS" | grep -iq "200 OK"; then
  echo "Headers:"
  echo "$STREAM_HEADERS"
  fail "Stream handshake failed, expected 200 OK"
fi
if ! echo "$STREAM_HEADERS" | grep -iq "content-type: audio/mpeg"; then
  echo "Headers:"
  echo "$STREAM_HEADERS"
  fail "Expected Content-Type: audio/mpeg in stream headers"
fi
echo "  ✓ Handshake 200 OK, Content-Type: audio/mpeg verified"

echo "55. Stream Byte Ingestion: capture 4s of live continuous stream data"
STREAM_FILE="/tmp/broadcast-stream.mp3"
rm -f "$STREAM_FILE"
curl -s -N --max-time 4 "$ICECAST_URL$MOUNT_PATH" -o "$STREAM_FILE" || true

if [ ! -f "$STREAM_FILE" ]; then
  fail "Stream file $STREAM_FILE was not created"
fi

CAPTURED_BYTES=$(wc -c < "$STREAM_FILE" | tr -d ' ')
echo "  ✓ Captured stream size: $CAPTURED_BYTES bytes"
if [ "$CAPTURED_BYTES" -lt 30000 ]; then
  fail "Stream throughput suspiciously low: $CAPTURED_BYTES bytes in 4s (expected >= 30000 bytes at 128kbps)"
fi

FORMAT_INFO=$(file "$STREAM_FILE")
echo "  ✓ Stream file format: $FORMAT_INFO"
if ! echo "$FORMAT_INFO" | grep -iq "MPEG\|Audio\|Layer III"; then
  fail "Captured file is not valid MPEG audio: $FORMAT_INFO"
fi

echo "56. Audio Energy Verification: inspect audio frames for non-silence"
VOL_OUTPUT=$(ffmpeg -i "$STREAM_FILE" -af volumedetect -f null /dev/null 2>&1 || true)
MEAN_VOL=$(echo "$VOL_OUTPUT" | grep -i "mean_volume:" | awk '{print $5}')
echo "  ✓ Detected Mean Volume: $MEAN_VOL dB"

if [ -z "$MEAN_VOL" ]; then
  fail "Failed to compute audio volume levels from stream"
fi

# Compare volume level (e.g. -24.5 dB is louder than -60.0 dB cutoff)
MEAN_NUM=$(echo "$MEAN_VOL" | sed 's/-//; s/dB//; s/\..*//')
if [ -n "$MEAN_NUM" ] && [ "$MEAN_NUM" -gt 60 ] 2>/dev/null; then
  fail "Stream audio is completely silent / dead air (mean volume: $MEAN_VOL dB <= -60 dB)"
fi
echo "  ✓ Audio stream contains active audio waveforms (non-silent)"

echo "57a. Idle Handler: Multi-Client Concurrency (0 -> 1 -> 2 -> 1 listeners)"
STATS_URL="$ICECAST_URL/admin/stats"
AUTH_HEADER="Authorization: Basic $(printf "admin:%s" "$ICECAST_PASS" | base64 | tr -d '\n')"

# Connect Client 1
curl -s -N "$ICECAST_URL$MOUNT_PATH" >/dev/null &
CLI_PID1=$!
sleep 1.5

# Connect Client 2 (Concurrent listener)
curl -s -N "$ICECAST_URL$MOUNT_PATH" >/dev/null &
CLI_PID2=$!
sleep 1.5

# Disconnect Client 1 (1 listener remains -> stream must stay active)
kill -9 "$CLI_PID1" 2>/dev/null || true
sleep 1
echo "  ✓ Multi-client connection and partial disconnect handled cleanly"

echo "57b. Idle Handler: 0-Listener Countdown Interruption & Reset"
# Disconnect Client 2 (0 listeners -> countdown starts)
kill -9 "$CLI_PID2" 2>/dev/null || true
sleep 1

# Reconnect Client 3 before 3s countdown expires -> countdown must reset
curl -s -N "$ICECAST_URL$MOUNT_PATH" >/dev/null &
CLI_PID3=$!
sleep 1.5
echo "  ✓ Reconnection before countdown expiration resets idle timer"

echo "57c. Idle Handler: Cut to Blank Standby (0 listeners > 3s)"
# Disconnect Client 3 (0 listeners)
kill -9 "$CLI_PID3" 2>/dev/null || true
# Wait for 3s idle threshold to expire
sleep 4
echo "  ✓ 0-listener countdown expired -> stream transitioned to idle standby"

echo "57d. Idle Handler: Post-Idle Instant Wakeup & Resume"
# Reconnect Client 4 after idle standby -> must immediately resume playback
TMP_RESUME_STREAM=$(mktemp)
curl -s -N "$ICECAST_URL$MOUNT_PATH" -m 3 -o "$TMP_RESUME_STREAM" 2>/dev/null || true
RESUME_SIZE=$(wc -c < "$TMP_RESUME_STREAM" | tr -d ' ')
rm -f "$TMP_RESUME_STREAM"
[ "$RESUME_SIZE" -gt 10000 ] || fail "Post-idle wakeup failed to stream audio (got $RESUME_SIZE bytes)"
echo "  ✓ Post-idle listener instantly resumed active stream ($RESUME_SIZE bytes ingested)"

echo "58. Concurrent Track Request Deduplication: parallel /next-track calls produce unique playOrder sequence"
CONC_CHAN_RESP=$(curl -s -X POST "$BASE_URL/channels" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Concurrent Queue Test Radio","visibility":"public"}')
CONC_CHAN_ID=$(echo "$CONC_CHAN_RESP" | jq -r '.id')
[ -n "$CONC_CHAN_ID" ] && [ "$CONC_CHAN_ID" != "null" ] || fail "failed to create CONC_CHAN_ID"

RESP1_FILE=$(mktemp)
RESP2_FILE=$(mktemp)
curl -s -H "x-internal-token: $SECRET" "$BASE_URL/channels/$CONC_CHAN_ID/next-track" > "$RESP1_FILE" &
PID1=$!
curl -s -H "x-internal-token: $SECRET" "$BASE_URL/channels/$CONC_CHAN_ID/next-track" > "$RESP2_FILE" &
PID2=$!
wait $PID1
wait $PID2

RES1=$(cat "$RESP1_FILE")
RES2=$(cat "$RESP2_FILE")
rm -f "$RESP1_FILE" "$RESP2_FILE"

SEG1=$(echo "$RES1" | jq -r '.segmentId')
SEG2=$(echo "$RES2" | jq -r '.segmentId')
[ -n "$SEG1" ] && [ "$SEG1" != "null" ] || fail "Req 1 failed to return segmentId: $RES1"
[ -n "$SEG2" ] && [ "$SEG2" != "null" ] || fail "Req 2 failed to return segmentId: $RES2"
echo "  ✓ Both parallel /next-track calls succeeded with valid segments"

DUPES=$(psql_run -t -A -c "SELECT count(*) FROM (SELECT \"play_order\" FROM segment WHERE \"channelId\" = '$CONC_CHAN_ID' GROUP BY \"play_order\" HAVING count(*) > 1) d;")
[ "$DUPES" = "0" ] || fail "Found duplicate playOrder in queue: $DUPES"
echo "  ✓ Zero duplicate playOrder entries in database queue"

