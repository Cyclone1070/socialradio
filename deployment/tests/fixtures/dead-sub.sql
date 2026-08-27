-- Ephemeral E2E fixture: 19 active subreddits with 1 unplayed post each,
-- attached to :chan_id.
-- Combined with r/AskReddit (which has 0 posts before scrape),
-- the channel reaches 19 active subreddits.
--
-- Usage:
--   psql_run -v chan_id="$CHAN_ID" -f /scripts/fixtures/dead-sub.sql

-- 1. Insert 19 active subreddits
INSERT INTO subreddit ("id", "name", "last_scraped_at")
SELECT gen_random_uuid(), 'pool_sub_e2e_' || i, now()
FROM generate_series(1, 19) AS i
ON CONFLICT ("name") DO NOTHING;

-- 2. Insert 1 post for each of the 19 subreddits
INSERT INTO post ("id", "subredditId", "reddit_id", "title", "body", "score", "reddit_created_at", "scraped_at")
SELECT gen_random_uuid(), s.id, 'r_post_e2e_' || i, 'Title ' || i, 'Body ' || i, 100, now(), now()
FROM generate_series(1, 19) AS i
JOIN subreddit s ON s.name = ('pool_sub_e2e_' || i)
ON CONFLICT ("reddit_id") DO NOTHING;

-- 3. Subscribe channel to all 19 subreddits
INSERT INTO channel_subreddit ("channelId", "subredditId")
SELECT :'chan_id', s.id
FROM subreddit s
WHERE s.name LIKE 'pool_sub_e2e_%'
ON CONFLICT DO NOTHING;
