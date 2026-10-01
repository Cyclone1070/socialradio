#!/bin/sh
set -e

. /scripts/lib/common.sh

TOKEN=$(get_admin_token)
ensure_base_fixtures

echo ""
echo "=== Section 7: Live AI Talk Generation & SeaweedFS Blob Storage ==="

# Clean all extraneous posts & comments so only mock fixture data exists in DB
psql_run -c "
  DELETE FROM channel_post_progress;
  DELETE FROM comment;
  DELETE FROM post;
" >/dev/null

echo "46. Seed targeted AI talk fixture (r/ai_talk_fixture_sub_e2e)"
psql_run -f /scripts/fixtures/ai-talk.sql >/dev/null \
  || fail "ai-talk.sql fixture failed"
echo "  ✓ Targeted Reddit dilemma post and comments seeded in DB"

echo "47. POST /channels (Create dedicated AI radio channel)"
assert_status POST "$BASE_URL/channels" 201 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"AI Talk & SeaweedFS Verification Radio","visibility":"public"}'
AI_CHAN_ID=$(echo "$BODY" | jq -r '.id')
[ -n "$AI_CHAN_ID" ] && [ "$AI_CHAN_ID" != "null" ] || fail "failed to extract AI_CHAN_ID"
echo "  ✓ AI radio channel created: $AI_CHAN_ID"

echo "48. POST /channels/$AI_CHAN_ID/subreddits (Subscribe r/ai_talk_fixture_sub_e2e)"
assert_status POST "$BASE_URL/channels/$AI_CHAN_ID/subreddits" 201 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subredditName":"ai_talk_fixture_sub_e2e"}'
assert_empty_body

assert_status GET "$BASE_URL/channels/$AI_CHAN_ID/subreddits" 200 \
  -H "Authorization: Bearer $TOKEN"
assert_jq '[.[] | select(.name == "ai_talk_fixture_sub_e2e")] | length == 1' 'ai_talk_fixture_sub_e2e in channel subreddits list'

echo "49. GET /channels/$AI_CHAN_ID/live.m3u8 (Trigger bufferAhead -> Synthesizes live AI TalkSegment)"
echo "  Calling OpenCode Zen LLM + Microsoft Edge Neural TTS (generating dialogue and audio)..."
assert_status GET "$BASE_URL/channels/$AI_CHAN_ID/live.m3u8" 200
if ! echo "$BODY" | grep -q '^#EXTM3U'; then
  fail "Manifest does not start with #EXTM3U: $BODY"
fi
echo "  ✓ Cold start returned valid RFC 8216 live.m3u8 manifest immediately (non-blocking)"

echo "  Waiting for background AI talk generation (LLM + Edge TTS)..."
MAX_WAIT=60
i=0
TALK_STATUS=""
while [ $i -lt $MAX_WAIT ]; do
  TALK_STATUS=$(psql_run -t -A -c "SELECT \"status\" FROM segment WHERE \"channel_id\" = '$AI_CHAN_ID' AND \"type\" = 'talk' ORDER BY \"play_order\" ASC LIMIT 1;" 2>/dev/null || echo "")
  if [ "$TALK_STATUS" = "ready" ]; then
    break
  fi
  i=$((i+1))
  sleep 1
done

if [ "$TALK_STATUS" != "ready" ]; then
  fail "expected TalkSegment status 'ready' within ${MAX_WAIT}s, got '$TALK_STATUS'"
fi
echo "  ✓ TalkSegment generated in background and status in DB is 'ready' after ~${i}s"

TALK_AUDIO_URL=$(psql_run -t -A -c "SELECT \"audio_url\" FROM segment WHERE \"channel_id\" = '$AI_CHAN_ID' AND \"type\" = 'talk' ORDER BY \"play_order\" ASC LIMIT 1;")
TALK_DURATION=$(psql_run -t -A -c "SELECT \"duration_seconds\" FROM segment WHERE \"channel_id\" = '$AI_CHAN_ID' AND \"type\" = 'talk' ORDER BY \"play_order\" ASC LIMIT 1;")
TALK_SCRIPT=$(psql_run -t -A -c "SELECT \"script\" FROM segment WHERE \"channel_id\" = '$AI_CHAN_ID' AND \"type\" = 'talk' ORDER BY \"play_order\" ASC LIMIT 1;")

echo "  ✓ Generated Talk Audio URL: $TALK_AUDIO_URL"
echo "  ✓ Generated Talk Duration: ${TALK_DURATION}s"

if [ -z "$TALK_AUDIO_URL" ] || [ "$TALK_AUDIO_URL" = "null" ]; then
  fail "TalkSegment audio_url is empty"
fi

# The stored talk track has to be real audio, and the duration the station recorded
# for it has to match. That number drives the playhead and the HLS timeline, so a
# wrong one is a stream claiming a length its audio does not have. The unit gate
# cannot check this: it replaces the speech library, so only this tier ever decodes
# what the station really produced.
TALK_FILE="/tmp/talk-segment.mp3"
if ! curl -s -f "$STORAGE_URL/$BUCKET/$TALK_AUDIO_URL" -o "$TALK_FILE"; then
  fail "talk audio $TALK_AUDIO_URL could not be downloaded from storage"
fi

TALK_FORMAT=$(file "$TALK_FILE")
case "$TALK_FORMAT" in
  *MPEG* | *Audio*) ;;
  *) fail "stored talk audio is not audio: $TALK_FORMAT" ;;
esac
echo "  ✓ talk audio in storage is real audio: $TALK_FORMAT"

TALK_ACTUAL=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$TALK_FILE" 2>/dev/null || echo "")
if [ -z "$TALK_ACTUAL" ]; then
  fail "could not measure the stored talk audio with ffprobe"
fi

if ! awk -v recorded="$TALK_DURATION" -v actual="$TALK_ACTUAL" 'BEGIN {
  diff = recorded - actual; if (diff < 0) diff = -diff;
  # The station derives the duration from the byte count at the format it requests,
  # so this allows for container overhead; it still catches a wrong constant, a
  # truncated track, or audio replaced by silence.
  tolerance = actual * 0.10 + 2;
  exit (diff <= tolerance) ? 0 : 1
}'; then
  fail "recorded duration ${TALK_DURATION}s does not match the audio's ${TALK_ACTUAL}s"
fi
echo "  ✓ talk duration matches the audio: recorded ${TALK_DURATION}s, decoded ${TALK_ACTUAL}s"

if ! echo "$TALK_SCRIPT" | jq -e 'type == "array" and length >= 3' >/dev/null 2>&1; then
  fail "TalkSegment script is not a valid multi-turn array: $TALK_SCRIPT"
fi
echo "  ✓ TalkSegment script contains multi-turn dialogue"

# The script must be the recorded dialogue, not something invented. A fabricated
# fallback has several turns too, so a turn count alone cannot tell the two apart.
# The line to look for comes from the fixture itself, so re-recording the fixture
# moves this assertion with it instead of leaving a stale phrase behind.
LLM_FIXTURE_LINE=$(cat /scripts/fixtures/llm-dialogue-fingerprint.txt 2>/dev/null || echo "")
if [ -z "$LLM_FIXTURE_LINE" ]; then
  fail "llm-dialogue-fingerprint.txt is empty - the recorded dialogue cannot be identified"
fi
if ! echo "$TALK_SCRIPT" | grep -qF "$LLM_FIXTURE_LINE"; then
  fail "talk script is not the recorded dialogue - something invented it: $TALK_SCRIPT"
fi
echo "  ✓ talk script came from the recorded LLM fixture, not from invented content"

# The aired post must be recorded through the app's own code path. The suites used
# to insert these rows by hand, which is how a broken insert stayed hidden.
PROGRESS_ROWS=$(psql_run -t -A -c "SELECT COUNT(*) FROM channel_post_progress WHERE \"channel_id\" = '$AI_CHAN_ID';")
if [ "$PROGRESS_ROWS" = "0" ]; then
  fail "no channel_post_progress row: the aired post was never recorded"
fi
echo "  ✓ aired post recorded in channel_post_progress ($PROGRESS_ROWS row(s))"

echo "50. SeaweedFS Blob Storage Verification: verify generated MP3 object exists and is non-empty (>10KB)"
STORAGE_BLOB_URL="$STORAGE_URL/$BUCKET/$TALK_AUDIO_URL"
req GET "$STORAGE_BLOB_URL"
echo "  Status from SeaweedFS: $STATUS"
if [ "$STATUS" != "200" ]; then
  fail "failed to fetch audio blob from SeaweedFS ($STORAGE_BLOB_URL), HTTP status $STATUS"
fi

BLOB_SIZE=$(curl -sI "$STORAGE_BLOB_URL" | grep -i "content-length" | awk '{print $2}' | tr -d '\r')
echo "  ✓ SeaweedFS audio blob Content-Length: ${BLOB_SIZE} bytes"
if [ -n "$BLOB_SIZE" ] && [ "$BLOB_SIZE" -gt 10000 ] 2>/dev/null; then
  echo "  ✓ Audio blob is non-empty and verified in SeaweedFS object storage (>10KB)"
else
  fail "Audio blob in SeaweedFS is suspiciously small or empty (size: $BLOB_SIZE)"
fi
