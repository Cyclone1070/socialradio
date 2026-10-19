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
echo "  Calling the Tier 1 mocks: the LLM stub, and the speech stub answering with real recorded audio..."
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

echo "51. The block the run wrote: conversations, then the break that closes it"
BLOCK_SHAPE=$(psql_run -t -A -c "SELECT string_agg(type, ',' ORDER BY play_order) FROM segment WHERE \"channel_id\" = '$AI_CHAN_ID';")
echo "  Block shape: $BLOCK_SHAPE"
case "$BLOCK_SHAPE" in
  *talk,liner,music*) echo "  ✓ the run closed its block with an announcement and a song" ;;
  *talk,music*)       echo "  ✓ the run closed its block with a song (no liner pool in this fixture)" ;;
  *) fail "the block does not end the way the plan says: $BLOCK_SHAPE" ;;
esac

if psql_run -t -A -c "SELECT outline FROM segment WHERE \"channel_id\" = '$AI_CHAN_ID' AND type = 'talk' AND outline IS NULL LIMIT 1;" | grep -q .; then
  fail "a conversation was stored without the outline it was written from"
fi
echo "  ✓ every stored conversation carries its Stage 1 outline"

echo "51b. The manifest marks the type changes as discontinuities"
req GET "$BASE_URL/channels/$AI_CHAN_ID/live.m3u8"
WINDOW_MANIFEST="$BODY"
if ! echo "$WINDOW_MANIFEST" | grep -q '#EXT-X-DISCONTINUITY'; then
  fail "the window spans a type change but carries no #EXT-X-DISCONTINUITY: $WINDOW_MANIFEST"
fi
WINDOW_CHUNKS=$(echo "$WINDOW_MANIFEST" | grep -c '#EXTINF:' || echo "0")
echo "  ✓ discontinuity present across a window of $WINDOW_CHUNKS chunk(s)"

echo "51c. Continuity: the second conversation picks up where the first left off"
FIRST_SCRIPT=$(psql_run -t -A -c "SELECT script::text FROM segment WHERE \"channel_id\" = '$AI_CHAN_ID' AND type = 'talk' ORDER BY play_order LIMIT 1;")
LATER_SCRIPT=$(psql_run -t -A -c "SELECT script::text FROM segment WHERE \"channel_id\" = '$AI_CHAN_ID' AND type = 'talk' ORDER BY play_order OFFSET 1 LIMIT 1;")

if echo "$FIRST_SCRIPT" | grep -q 'Picking up where we left off'; then
  fail "the first conversation of the show claims to be picking up a thread that never aired"
fi
echo "  ✓ the first conversation opens the show rather than pretending to continue one"

if ! echo "$LATER_SCRIPT" | grep -q 'Picking up where we left off'; then
  fail "the second conversation does not refer back to the one before it: $LATER_SCRIPT"
fi
if ! echo "$LATER_SCRIPT" | grep -q 'HOST INTRO'; then
  fail "the second conversation does not carry the previous outline it was given"
fi
echo "  ✓ the second conversation quotes the outline of the one before it"

echo "51d. Marking: a conversation cannot air without its post being recorded"
# The provable direction: everything that aired was marked. The reverse is not an
# invariant - a topic the model refuses is retired (marked) without ever airing, by
# design, so "marked but not aired" is legitimate and cannot be told apart here.
UNAIRED=$(psql_run -t -A -c "SELECT COUNT(*) FROM segment s WHERE s.\"channel_id\" = '$AI_CHAN_ID' AND s.type = 'talk' AND NOT EXISTS (SELECT 1 FROM channel_post_progress p WHERE p.\"channel_id\" = s.\"channel_id\" AND p.post_id::text = s.cluster_id);")
if [ "$UNAIRED" != "0" ]; then
  fail "$UNAIRED conversation(s) aired without their post being recorded as used"
fi
MARKED_ROWS=$(psql_run -t -A -c "SELECT COUNT(*) FROM channel_post_progress WHERE \"channel_id\" = '$AI_CHAN_ID';")
AIRED_TALK=$(psql_run -t -A -c "SELECT COUNT(*) FROM segment WHERE \"channel_id\" = '$AI_CHAN_ID' AND type = 'talk';")
if [ "$MARKED_ROWS" -lt "$AIRED_TALK" ]; then
  fail "only $MARKED_ROWS post(s) recorded for $AIRED_TALK conversation(s) that aired"
fi
echo "  ✓ every one of the $AIRED_TALK conversation(s) that aired is recorded ($MARKED_ROWS post row(s))"

echo "51e. No filler inside a block: a song or an announcement never interrupts the conversations"
INTERLEAVED=$(psql_run -t -A -c "SELECT COUNT(*) FROM segment s WHERE s.\"channel_id\" = '$AI_CHAN_ID' AND s.type IN ('music', 'liner', 'jingle') AND EXISTS (SELECT 1 FROM segment a WHERE a.\"channel_id\" = s.\"channel_id\" AND a.type = 'talk' AND a.play_order < s.play_order) AND EXISTS (SELECT 1 FROM segment b WHERE b.\"channel_id\" = s.\"channel_id\" AND b.type = 'talk' AND b.play_order > s.play_order);")
if [ "$INTERLEAVED" != "0" ]; then
  fail "$INTERLEAVED piece(s) of filler landed between two conversations"
fi
echo "  ✓ the block is conversations first, filler last"

echo "51f. The station never goes quiet: drain the runway, and the request that notices serves the filler"
DRAIN_MAX=$(psql_run -t -A -c "SELECT COALESCE(MAX(play_order), 0) FROM segment WHERE \"channel_id\" = '$AI_CHAN_ID';")
psql_run -c "UPDATE channel SET playhead_started_at = now() - interval '3600 seconds' WHERE id = '$AI_CHAN_ID';" >/dev/null
req GET "$BASE_URL/channels/$AI_CHAN_ID/live.m3u8"
if [ "$STATUS" != "200" ]; then
  fail "a drained station served no manifest at all (HTTP $STATUS)"
fi
FILLER_CHUNKS=$(echo "$BODY" | grep -c '#EXTINF:' || echo "0")
if [ "$FILLER_CHUNKS" -lt 2 ]; then
  fail "a drained station served $FILLER_CHUNKS chunk(s) instead of filler"
fi
FILLER_BEHIND_SONG=$(psql_run -t -A -c "SELECT string_agg(type, ',' ORDER BY play_order) FROM segment WHERE \"channel_id\" = '$AI_CHAN_ID' AND play_order > $DRAIN_MAX;")
case "$FILLER_BEHIND_SONG" in
  music,music*) echo "  ✓ behind a break the filler is songs only, no announcement ($FILLER_BEHIND_SONG)" ;;
  *) fail "the filler behind a break should be songs only, got: $FILLER_BEHIND_SONG" ;;
esac

echo "51g. Filler behind a conversation announces itself first"
LAST_ORDER=$(psql_run -t -A -c "SELECT COALESCE(MAX(play_order), 0) FROM segment WHERE \"channel_id\" = '$AI_CHAN_ID';")
psql_run -c "INSERT INTO segment (id, \"channel_id\", play_order, type, duration_seconds, audio_url, cluster_id, status) VALUES (gen_random_uuid(), '$AI_CHAN_ID', $((LAST_ORDER + 1)), 'talk', 30, '$TALK_AUDIO_URL', 'seed-tail-cluster', 'ready');" >/dev/null
psql_run -c "UPDATE channel SET playhead_started_at = now() - interval '3600 seconds' WHERE id = '$AI_CHAN_ID';" >/dev/null
req GET "$BASE_URL/channels/$AI_CHAN_ID/live.m3u8"
if [ "$STATUS" != "200" ]; then
  fail "a drained station behind a conversation served no manifest (HTTP $STATUS)"
fi
FILLER_BEHIND_TALK=$(psql_run -t -A -c "SELECT string_agg(type, ',' ORDER BY play_order) FROM segment WHERE \"channel_id\" = '$AI_CHAN_ID' AND play_order > $((LAST_ORDER + 1));")
case "$FILLER_BEHIND_TALK" in
  liner,music,music*) echo "  ✓ behind a conversation the filler announces itself, then two songs ($FILLER_BEHIND_TALK)" ;;
  *) fail "the filler behind a conversation should be liner,music,music - got: $FILLER_BEHIND_TALK" ;;
esac
