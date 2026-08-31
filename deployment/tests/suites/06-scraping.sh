#!/bin/sh
set -e

. /scripts/lib/common.sh

TOKEN=$(get_admin_token)

# Ensure a dedicated channel with AskReddit exists for scraping tests
req POST "$BASE_URL/channels" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Scraping E2E Radio","visibility":"public"}'
CHAN_ID=$(echo "$BODY" | jq -r '.id')
[ -n "$CHAN_ID" ] && [ "$CHAN_ID" != "null" ] || fail "failed to create scraping test channel"

req POST "$BASE_URL/channels/$CHAN_ID/subreddits" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subredditName":"AskReddit"}'

echo ""
echo "=== Section 6: Topics, Real Reddit Scraping & Active Pool ==="

echo "40. SQL fixture: seed 19 active subs with posts (pool_sub_e2e_1..19)"
psql_run -v chan_id="$CHAN_ID" -f /scripts/fixtures/dead-sub.sql >/dev/null \
  || fail "dead-sub.sql failed"

assert_status GET "$BASE_URL/channels/$CHAN_ID/subreddits" 200 \
  -H "Authorization: Bearer $TOKEN"
assert_jq 'length == 20' '20 subreddits subscribed (1 AskReddit + 19 pool)'
assert_jq '[.[] | select((.name | ascii_downcase) == "askreddit")] | length == 1' 'AskReddit in list'

echo "41. GET /admin/channels/$CHAN_ID/topics (Deficit trigger: active pool = 19 < 20 -> triggers AskReddit scrape)"
assert_status GET "$BASE_URL/admin/channels/$CHAN_ID/topics" 200 \
  -H "Authorization: Bearer $TOKEN"
assert_jq '.id != null' 'topic id present'
assert_jq '.posts | type == "array" and length > 0' 'non-empty posts array'

echo "42. Poll: wait for AskReddit background scrape to finish"
MAX_WAIT=120
i=0
SCRAPED=0
while [ $i -lt $MAX_WAIT ]; do
  POST_COUNT=$(psql_run -t -A -c "
    SELECT COUNT(*) FROM post p
    JOIN subreddit s ON s.id = p.\"subredditId\"
    WHERE LOWER(s.name) = 'askreddit';
  ")
  if [ -n "$POST_COUNT" ] && [ "$POST_COUNT" -gt 0 ] 2>/dev/null; then
    SCRAPED=1
    break
  fi
  i=$((i+1))
  sleep 1
done
[ "$SCRAPED" = 1 ] || fail "AskReddit scrape did not complete within ${MAX_WAIT}s"
echo "  ✓ AskReddit scraped ($POST_COUNT posts) after ~${i}s"

echo "43. SQL fixture: inject dead_prod_sub_e2e_77401 behind API gate"
psql_run -c "
  INSERT INTO subreddit (\"id\", \"name\", \"last_scraped_at\")
  VALUES (gen_random_uuid(), 'dead_prod_sub_e2e_77401', NULL)
  ON CONFLICT DO NOTHING;

  INSERT INTO channel_subreddit (\"channelId\", \"subredditId\")
  SELECT '$CHAN_ID', id FROM subreddit WHERE name = 'dead_prod_sub_e2e_77401'
  ON CONFLICT DO NOTHING;
" >/dev/null || fail "dead sub injection failed"

assert_status GET "$BASE_URL/channels/$CHAN_ID/subreddits" 200 \
  -H "Authorization: Bearer $TOKEN"
assert_jq 'length == 21' '21 subreddits subscribed (20 active + 1 dead)'
assert_jq '[.[] | select(.name == "dead_prod_sub_e2e_77401")] | length == 1' 'dead sub in list'

echo "44. GET /admin/channels/$CHAN_ID/topics (Active pool = 20 >= 20 -> 0 scrapes triggered)"
assert_status GET "$BASE_URL/admin/channels/$CHAN_ID/topics" 200 \
  -H "Authorization: Bearer $TOKEN"
assert_jq '.id != null' 'topic resolved from active pool'

assert_status GET "$BASE_URL/channels/$CHAN_ID/subreddits" 200 \
  -H "Authorization: Bearer $TOKEN"
assert_jq '[.[] | select(.name == "dead_prod_sub_e2e_77401")] | length == 1' 'dead sub STILL subscribed (0 scrapes triggered)'

echo "45. Mark 1 post completed -> Active pool drops to 19 < 20 (toScrapeCount = 1) -> triggers dead sub scrape & cascade"
psql_run -c "INSERT INTO channel_post_progress (\"channelId\", \"postId\") SELECT '$CHAN_ID', \"id\" FROM post WHERE \"reddit_id\" = 'r_post_e2e_1' ON CONFLICT DO NOTHING;" >/dev/null \
  || fail "post progress update failed"

assert_status GET "$BASE_URL/admin/channels/$CHAN_ID/topics" 200 \
  -H "Authorization: Bearer $TOKEN"
assert_jq '.id != null' 'topic resolved'

i=0
GONE=1
while [ $i -lt 45 ]; do
  SUB_EXISTS=$(psql_run -t -A -c "SELECT COUNT(*) FROM channel_subreddit cs JOIN subreddit s ON s.id = cs.\"subredditId\" WHERE cs.\"channelId\" = '$CHAN_ID' AND s.name = 'dead_prod_sub_e2e_77401';")
  if [ "$SUB_EXISTS" = "0" ]; then
    GONE=0
    break
  fi
  i=$((i+1))
  sleep 3
done
[ "$GONE" = 0 ] || fail "dead sub still subscribed after 135s (scrape chain did not trigger when active pool < 20)"
echo "  ✓ dead sub gone (chain isInvalid -> delete -> cascade) after ~$((i * 3))s"

# Clean up Section 6 scraped posts and subreddits so only mock data exists for AI generation
psql_run -c "
  DELETE FROM channel_subreddit WHERE \"channelId\" = '$CHAN_ID';
  DELETE FROM comment WHERE \"postId\" IN (SELECT id FROM post WHERE \"subredditId\" IN (SELECT id FROM subreddit WHERE name LIKE 'pool_sub_e2e_%' OR name = 'AskReddit'));
  DELETE FROM post WHERE \"subredditId\" IN (SELECT id FROM subreddit WHERE name LIKE 'pool_sub_e2e_%' OR name = 'AskReddit');
  DELETE FROM subreddit WHERE name LIKE 'pool_sub_e2e_%' OR name = 'AskReddit';
" >/dev/null

