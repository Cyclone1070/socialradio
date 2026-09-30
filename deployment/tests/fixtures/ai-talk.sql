-- Ephemeral E2E fixture: Targeted realistic Reddit post + comments on made-up sub r/ai_talk_fixture_sub_e2e
-- Used for fast, deterministic Section 7 AI Talk synthesis (< 150 prompt tokens)
--
-- Note: Contains 2 posts so that after Post #1 is selected for TalkSegment #1,
-- Post #2 keeps activeSubs = 1 (active pool = 1 >= target 1), preventing unnecessary scrape triggers.
--
-- Usage:
--   psql_run -f /scripts/fixtures/ai-talk.sql

-- 1. Insert made-up subreddit
INSERT INTO subreddit ("id", "name", "last_scraped_at", "scrape_started_at")
VALUES (
  gen_random_uuid(),
  'ai_talk_fixture_sub_e2e',
  now(),
  now()
)
ON CONFLICT ("name") DO UPDATE SET "last_scraped_at" = now(), "scrape_started_at" = now();

-- 2. Insert Post #1: Concise authentic dilemma post (Primary topic)
INSERT INTO post ("id", "subreddit_id", "reddit_id", "title", "body", "score", "reddit_created_at", "scraped_at")
SELECT
  gen_random_uuid(),
  s.id,
  'r_post_ai_talk_fixture_1',
  'My neighbor built a fence across my driveway while I was at work',
  'I came home today and found a six-foot wooden fence cutting right through the middle of my driveway. He claims the property line was surveyed in 1982 and the driveway encroaches on his yard. What is my best move here?',
  1450,
  now(),
  now()
FROM subreddit s
WHERE s.name = 'ai_talk_fixture_sub_e2e'
ON CONFLICT ("reddit_id") DO NOTHING;

-- 3. Insert Buffer Posts (distinct topics to ensure independent 1-post clusters)
INSERT INTO post ("id", "subreddit_id", "reddit_id", "title", "body", "score", "reddit_created_at", "scraped_at")
SELECT gen_random_uuid(), s.id, 'r_post_ai_talk_fixture_2', 'What is the most memorable concert you have ever attended in your life?', 'Looking back at all live events, which show stands out as the absolute greatest?', 500, now(), now()
FROM subreddit s WHERE s.name = 'ai_talk_fixture_sub_e2e'
ON CONFLICT ("reddit_id") DO NOTHING;

INSERT INTO post ("id", "subreddit_id", "reddit_id", "title", "body", "score", "reddit_created_at", "scraped_at")
SELECT gen_random_uuid(), s.id, 'r_post_ai_talk_fixture_3', 'Best recipe for homemade crispy thin pizza dough', 'Sharing my grandmother secret technique for high hydration 48-hour cold fermentation.', 450, now(), now()
FROM subreddit s WHERE s.name = 'ai_talk_fixture_sub_e2e'
ON CONFLICT ("reddit_id") DO NOTHING;

INSERT INTO post ("id", "subreddit_id", "reddit_id", "title", "body", "score", "reddit_created_at", "scraped_at")
SELECT gen_random_uuid(), s.id, 'r_post_ai_talk_fixture_4', 'Essential maintenance tips for vintage mechanical wrist watches', 'How often should you get a mechanical timepiece serviced by an authorized watchmaker?', 400, now(), now()
FROM subreddit s WHERE s.name = 'ai_talk_fixture_sub_e2e'
ON CONFLICT ("reddit_id") DO NOTHING;

INSERT INTO post ("id", "subreddit_id", "reddit_id", "title", "body", "score", "reddit_created_at", "scraped_at")
SELECT gen_random_uuid(), s.id, 'r_post_ai_talk_fixture_5', 'Why classic science fiction novels accurately predicted satellites but missed portable computers', 'Fascinating perspective on technology forecasting from 1950s literature.', 350, now(), now()
FROM subreddit s WHERE s.name = 'ai_talk_fixture_sub_e2e'
ON CONFLICT ("reddit_id") DO NOTHING;

-- 4. Insert 3 structured comments for Post #1 (Community stance, OP response, Legal advice)
INSERT INTO comment ("id", "post_id", "reddit_id", "body", "score", "parent_reddit_id", "is_op", "reddit_created_at")
SELECT
  gen_random_uuid(),
  p.id,
  'r_comm_ai_talk_1',
  'Do not touch or take down the fence yourself. Call your city code enforcement and pull your title insurance policy immediately.',
  620,
  NULL,
  false,
  now()
FROM post p
WHERE p.reddit_id = 'r_post_ai_talk_fixture_1'
ON CONFLICT ("reddit_id") DO NOTHING;

INSERT INTO comment ("id", "post_id", "reddit_id", "body", "score", "parent_reddit_id", "is_op", "reddit_created_at")
SELECT
  gen_random_uuid(),
  p.id,
  'r_comm_ai_talk_2',
  'Thanks mate, I called code enforcement and they dispatched an officer for tomorrow morning.',
  280,
  'r_comm_ai_talk_1',
  true,
  now()
FROM post p
WHERE p.reddit_id = 'r_post_ai_talk_fixture_1'
ON CONFLICT ("reddit_id") DO NOTHING;

INSERT INTO comment ("id", "post_id", "reddit_id", "body", "score", "parent_reddit_id", "is_op", "reddit_created_at")
SELECT
  gen_random_uuid(),
  p.id,
  'r_comm_ai_talk_3',
  'If the driveway has been there for over 15 years, you likely have a prescriptive easement anyway.',
  410,
  NULL,
  false,
  now()
FROM post p
WHERE p.reddit_id = 'r_post_ai_talk_fixture_1'
ON CONFLICT ("reddit_id") DO NOTHING;

-- 5. Insert structured comments for Post #2
INSERT INTO comment ("id", "post_id", "reddit_id", "body", "score", "parent_reddit_id", "is_op", "reddit_created_at")
SELECT
  gen_random_uuid(),
  p.id,
  'r_comm_ai_talk_4',
  'I learned sour dough bread baking and now bake fresh loaves every Sunday.',
  350,
  NULL,
  false,
  now()
FROM post p
WHERE p.reddit_id = 'r_post_ai_talk_fixture_2'
ON CONFLICT ("reddit_id") DO NOTHING;

INSERT INTO comment ("id", "post_id", "reddit_id", "body", "score", "parent_reddit_id", "is_op", "reddit_created_at")
SELECT
  gen_random_uuid(),
  p.id,
  'r_comm_ai_talk_5',
  'Same here, perfecting the crust temperature took months but totally worth it.',
  190,
  'r_comm_ai_talk_4',
  true,
  now()
FROM post p
WHERE p.reddit_id = 'r_post_ai_talk_fixture_2'
ON CONFLICT ("reddit_id") DO NOTHING;
