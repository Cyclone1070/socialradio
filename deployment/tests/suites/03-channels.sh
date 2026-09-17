#!/bin/sh
set -e

. /scripts/lib/common.sh

TOKEN=$(get_admin_token)

echo ""
echo "=== Section 3: Channels & Subreddits ==="

echo "11. POST /channels (Create -> 201)"
assert_status POST "$BASE_URL/channels" 201 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"AskReddit E2E Radio","visibility":"public"}'
assert_jq '.name == "AskReddit E2E Radio"' 'name matches'
assert_jq '.visibility == "public"' 'visibility is public'
assert_jq '.createdAt != null' 'createdAt present'
CHAN_ID=$(echo "$BODY" | jq -r '.id')
[ -n "$CHAN_ID" ] && [ "$CHAN_ID" != "null" ] || fail "channel id not found in response"
echo "  Channel ID: $CHAN_ID"

echo "12. GET /channels (List -> 200)"
assert_status GET "$BASE_URL/channels" 200 \
  -H "Authorization: Bearer $TOKEN"
assert_jq "[.[] | select(.id == \"$CHAN_ID\")] | length > 0" 'list contains the channel'

echo "13. POST /channels/$CHAN_ID/subreddits (Subscribe r/AskReddit -> 201)"
assert_status POST "$BASE_URL/channels/$CHAN_ID/subreddits" 201 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subredditName":"AskReddit"}'
assert_empty_body

assert_status GET "$BASE_URL/channels/$CHAN_ID/subreddits" 200 \
  -H "Authorization: Bearer $TOKEN"
assert_jq '[.[] | select((.name | ascii_downcase) == "askreddit")] | length == 1' 'AskReddit in list (read-back)'

echo "14. POST /channels/$CHAN_ID/subreddits (Duplicate r/AskReddit -> 201)"
assert_status POST "$BASE_URL/channels/$CHAN_ID/subreddits" 201 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subredditName":"AskReddit"}'
assert_empty_body

assert_status GET "$BASE_URL/channels/$CHAN_ID/subreddits" 200 \
  -H "Authorization: Bearer $TOKEN"
assert_jq '[.[] | select((.name | ascii_downcase) == "askreddit")] | length == 1' 'exactly one AskReddit (idempotent)'

echo "15. DELETE /channels/$CHAN_ID/subreddits/AskReddit -> 200"
assert_status DELETE "$BASE_URL/channels/$CHAN_ID/subreddits/AskReddit" 200 \
  -H "Authorization: Bearer $TOKEN"
assert_empty_body

assert_status GET "$BASE_URL/channels/$CHAN_ID/subreddits" 200 \
  -H "Authorization: Bearer $TOKEN"
assert_jq '[.[] | select((.name | ascii_downcase) == "askreddit")] | length == 0' 'AskReddit gone (read-back)'

echo "16. POST /channels/$CHAN_ID/subreddits (Re-subscribe r/AskReddit -> 201)"
assert_status POST "$BASE_URL/channels/$CHAN_ID/subreddits" 201 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subredditName":"AskReddit"}'
assert_empty_body

assert_status GET "$BASE_URL/channels/$CHAN_ID/subreddits" 200 \
  -H "Authorization: Bearer $TOKEN"
assert_jq '[.[] | select((.name | ascii_downcase) == "askreddit")] | length == 1' 'AskReddit back in list'

echo "17. POST /channels (Empty Name -> 400)"
assert_status POST "$BASE_URL/channels" 400 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":""}'
assert_jq '.statusCode == 400' 'body confirms 400'
assert_jq '.message | if type == "array" then .[] else . end | contains("name")' 'message mentions name'

echo "18. POST /channels/000.../subreddits (Fake UUID -> 404)"
assert_status POST "$BASE_URL/channels/00000000-0000-0000-0000-000000000000/subreddits" 404 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subredditName":"AskReddit"}'
assert_jq '.message == "Channel not found"' '404 message'

echo "19. POST /channels (No Auth / Bad Token -> 401)"
assert_status POST "$BASE_URL/channels" 401 \
  -H "Content-Type: application/json" \
  -d '{"name":"Unauth Channel"}'
assert_jq '.statusCode == 401' 'body confirms 401 on missing token'

assert_status POST "$BASE_URL/channels" 401 \
  -H "Authorization: Bearer malformed.jwt.token" \
  -H "Content-Type: application/json" \
  -d '{"name":"Unauth Channel"}'
assert_jq '.statusCode == 401' 'body confirms 401 on malformed jwt'

echo "19b. GET /channels (No Auth / Bad Token -> 401)"
assert_status GET "$BASE_URL/channels" 401
assert_jq '.statusCode == 401' 'body confirms 401 on missing token'

assert_status GET "$BASE_URL/channels" 401 \
  -H "Authorization: Bearer malformed.jwt.token"
assert_jq '.statusCode == 401' 'body confirms 401 on malformed jwt'

echo "20. POST /channels/$CHAN_ID/subreddits (No Auth -> 401)"
assert_status POST "$BASE_URL/channels/$CHAN_ID/subreddits" 401 \
  -H "Content-Type: application/json" \
  -d '{"subredditName":"AskReddit"}'
assert_jq '.statusCode == 401' 'body confirms 401'

assert_status POST "$BASE_URL/channels/$CHAN_ID/subreddits" 401 \
  -H "Authorization: Bearer malformed.jwt.token" \
  -H "Content-Type: application/json" \
  -d '{"subredditName":"AskReddit"}'
assert_jq '.statusCode == 401' 'body confirms 401 on malformed jwt'

echo "21. DELETE /channels/$CHAN_ID/subreddits/AskReddit (No Auth / Bad Token -> 401)"
assert_status DELETE "$BASE_URL/channels/$CHAN_ID/subreddits/AskReddit" 401
assert_jq '.statusCode == 401' 'body confirms 401'

assert_status DELETE "$BASE_URL/channels/$CHAN_ID/subreddits/AskReddit" 401 \
  -H "Authorization: Bearer malformed.jwt.token"
assert_jq '.statusCode == 401' 'body confirms 401 on malformed jwt'

echo "22. GET /channels/$CHAN_ID/subreddits (No Auth / Bad Token -> 401)"
assert_status GET "$BASE_URL/channels/$CHAN_ID/subreddits" 401
assert_jq '.statusCode == 401' 'body confirms 401 on no token'

assert_status GET "$BASE_URL/channels/$CHAN_ID/subreddits" 401 \
  -H "Authorization: Bearer malformed.jwt.token"
assert_jq '.statusCode == 401' 'body confirms 401 on malformed token'

echo "23. POST /channels/$CHAN_ID/subreddits (Invalid body -> 400)"
assert_status POST "$BASE_URL/channels/$CHAN_ID/subreddits" 400 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subredditName":123}'
assert_jq '.statusCode == 400' 'body confirms 400'

echo "24. DELETE /channels/$CHAN_ID/subreddits/nonexistent_subreddit_e2e_92831 (Not subscribed -> 404)"
assert_status DELETE "$BASE_URL/channels/$CHAN_ID/subreddits/nonexistent_subreddit_e2e_92831" 404 \
  -H "Authorization: Bearer $TOKEN"
assert_jq '.message == "Subreddit not found"' '404 message'

echo "25. GET /channels/active (Internal Token Guard -> 401 on missing/bad, 200 on valid)"
assert_status GET "$BASE_URL/channels/active" 401
assert_jq '.statusCode == 401' 'body confirms 401 without internal token'

assert_status GET "$BASE_URL/channels/active" 401 \
  -H "x-internal-token: wrong-secret"
assert_jq '.statusCode == 401' 'body confirms 401 with wrong internal token'

assert_status GET "$BASE_URL/channels/active" 200 \
  -H "x-internal-token: $SECRET"
assert_jq 'type == "array"' 'active channels returns array'

echo "26. DB Invariants: Channel string hygiene & media file_path uniqueness"
if psql_run -c "INSERT INTO channel (name) VALUES ('   ');" 2>/dev/null; then
  fail "DB allowed channel with whitespace name"
fi
echo "  ✓ DB check constraint rejected whitespace channel name"

if psql_run -c "INSERT INTO subreddit (name) VALUES ('   ');" 2>/dev/null; then
  fail "DB allowed subreddit with whitespace name"
fi
echo "  ✓ DB check constraint rejected whitespace subreddit name"

DUP_PATH="music/e2e-dup-test-track.mp3"
psql_run -c "INSERT INTO music_track (title, artist, file_path, duration_seconds) VALUES ('Dup1', 'Artist1', '$DUP_PATH', 60) ON CONFLICT DO NOTHING;" >/dev/null
if psql_run -c "INSERT INTO music_track (title, artist, file_path, duration_seconds) VALUES ('Dup2', 'Artist2', '$DUP_PATH', 120);" 2>/dev/null; then
  fail "DB allowed duplicate music_track.file_path"
fi
psql_run -c "DELETE FROM music_track WHERE file_path = '$DUP_PATH';" >/dev/null
echo "  ✓ DB unique constraint rejected duplicate music_track.file_path"
