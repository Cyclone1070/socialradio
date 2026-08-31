#!/bin/sh
set -e

. /scripts/lib/common.sh

TOKEN=$(get_admin_token)
ensure_base_fixtures

echo ""
echo "=== Section 7: Live AI Talk Generation & MinIO Blob Storage ==="

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
  -d '{"name":"AI Talk & MinIO Verification Radio","visibility":"public"}'
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

echo "49. GET /channels/$AI_CHAN_ID/next-track (Trigger bufferAhead -> Synthesizes live AI TalkSegment)"
echo "  Calling OpenCode Zen LLM + Microsoft Edge Neural TTS (generating dialogue and audio)..."
assert_status GET "$BASE_URL/channels/$AI_CHAN_ID/next-track" 200 \
  -H "x-internal-token: $SECRET"
assert_jq '.segmentId | type == "string" and length > 0' 'segmentId present in next-track response'
assert_jq '.type == "talk"' 'response type is talk'
assert_jq '.filePath | type == "string" and length > 0' 'filePath present in next-track response'
assert_jq '.durationSeconds | type == "number" and . > 0' 'durationSeconds is positive'

TALK_STATUS=$(psql_run -t -A -c "SELECT \"status\" FROM segment WHERE \"channelId\" = '$AI_CHAN_ID' AND \"type\" = 'talk' ORDER BY \"play_order\" ASC LIMIT 1;")
if [ "$TALK_STATUS" != "ready" ]; then
  fail "expected TalkSegment status 'ready', got '$TALK_STATUS'"
fi
echo "  ✓ TalkSegment status in DB is 'ready'"

TALK_AUDIO_URL=$(psql_run -t -A -c "SELECT \"audio_url\" FROM segment WHERE \"channelId\" = '$AI_CHAN_ID' AND \"type\" = 'talk' ORDER BY \"play_order\" ASC LIMIT 1;")
TALK_DURATION=$(psql_run -t -A -c "SELECT \"duration_seconds\" FROM segment WHERE \"channelId\" = '$AI_CHAN_ID' AND \"type\" = 'talk' ORDER BY \"play_order\" ASC LIMIT 1;")
TALK_SCRIPT=$(psql_run -t -A -c "SELECT \"script\" FROM segment WHERE \"channelId\" = '$AI_CHAN_ID' AND \"type\" = 'talk' ORDER BY \"play_order\" ASC LIMIT 1;")

echo "  ✓ Generated Talk Audio URL: $TALK_AUDIO_URL"
echo "  ✓ Generated Talk Duration: ${TALK_DURATION}s"

if [ -z "$TALK_AUDIO_URL" ] || [ "$TALK_AUDIO_URL" = "null" ]; then
  fail "TalkSegment audio_url is empty"
fi

if ! echo "$TALK_SCRIPT" | jq -e 'type == "array" and length >= 3' >/dev/null 2>&1; then
  fail "TalkSegment script is not a valid multi-turn array: $TALK_SCRIPT"
fi
echo "  ✓ TalkSegment script contains multi-turn dialogue"

echo "50. MinIO Blob Storage Verification: verify generated MP3 object exists and is non-empty (>10KB)"
MINIO_ENDPOINT="$MINIO_URL/$BUCKET/$TALK_AUDIO_URL"
req GET "$MINIO_ENDPOINT"
echo "  Status from MinIO: $STATUS"
if [ "$STATUS" != "200" ]; then
  fail "failed to fetch audio blob from MinIO ($MINIO_ENDPOINT), HTTP status $STATUS"
fi

BLOB_SIZE=$(curl -sI "$MINIO_ENDPOINT" | grep -i "content-length" | awk '{print $2}' | tr -d '\r')
echo "  ✓ MinIO audio blob Content-Length: ${BLOB_SIZE} bytes"
if [ -n "$BLOB_SIZE" ] && [ "$BLOB_SIZE" -gt 10000 ] 2>/dev/null; then
  echo "  ✓ Audio blob is non-empty and verified in MinIO object storage (>10KB)"
else
  fail "Audio blob in MinIO is suspiciously small or empty (size: $BLOB_SIZE)"
fi
