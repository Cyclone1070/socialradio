-- Ephemeral E2E fixture: a subreddit + its channel subscription, inserted
-- behind the public API (the subscribe gate rejects dead subs — it uses the
-- same shreddit-post validity signal the fetcher checks at scrape time).
-- Emulates the prod scenario "sub was valid at subscribe time, died later".
--
-- usage (from docker-test.sh, single SQL pattern):
--   psql_run -v chan_id="$CHAN_ID" -f /scripts/dead-sub-fixture.sql
--
-- The scrape chain then deletes the row (isInvalid), which cascades to this
-- junction row — the E2E asserts the subscription disappears.

INSERT INTO subreddit ("id", "name")
VALUES (gen_random_uuid(), 'dead_prod_sub_e2e_77401');

INSERT INTO channel_subreddit ("channelId", "subredditId")
SELECT :'chan_id',
       (SELECT "id" FROM subreddit WHERE "name" = 'dead_prod_sub_e2e_77401');
