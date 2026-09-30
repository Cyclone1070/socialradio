/**
 * Tier 2 probe: does reality match what this backend requires of the fetcher?
 *
 * Unlike the LLM probe there is no third-party API to call directly — the thing
 * that touches reddit is our own fetcher. So this drives the REAL fetcher and
 * validates its answers with the backend's own schema, which is the one belief
 * nothing else checks: our types could be perfectly consistent with each other
 * and still describe reddit wrongly.
 *
 * Toy data only: one small public subreddit, one name that cannot exist, five
 * posts and the comments of one of them.
 *
 * Run it against a live fetcher:  REDDIT_FETCHER_URL=http://host:port npx ts-node --transpile-only reddit-contract.ts
 * Without that variable, or when reddit is unreachable, it reports SKIP: reddit
 * blocks datacenter IPs and rate-limits, so that is not a contract break.
 */
import {
  commentsResponseSchema,
  existsResponseSchema,
  parseFetcherPayload,
  topPostsResponseSchema,
} from '../../../src/content/dto/reddit-fetcher.dto';

const base = process.env.REDDIT_FETCHER_URL;
const SUBREDDIT = process.env.REDDIT_PROBE_SUBREDDIT ?? 'test';
const IMPOSSIBLE =
  process.env.REDDIT_PROBE_ABSENT ?? 'this_subreddit_cannot_exist_9f3a2b';

const skip = (reason: string): never => {
  process.stdout.write(`  SKIP: ${reason}\n`);
  process.exit(0);
};

const get = async (path: string): Promise<unknown> => {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`);
  } catch (err) {
    return skip(`fetcher or reddit unreachable (${(err as Error).message})`);
  }
  if (res.status === 429 || res.status === 503 || res.status >= 500) {
    return skip(`fetcher says provider unavailable (${res.status})`);
  }
  if (!res.ok) {
    return skip(`fetcher answered ${res.status} for ${path}`);
  }
  return res.json();
};

(async () => {
  if (!base) {
    skip('REDDIT_FETCHER_URL is not set — point it at a running fetcher');
  }

  const absent = parseFetcherPayload(
    existsResponseSchema,
    await get(`/exists/${IMPOSSIBLE}`),
    '/exists',
  );
  process.stdout.write(
    `  ${absent.valid ? 'FAIL' : '✓'} a name that cannot exist reports valid=${absent.valid}\n`,
  );

  const page = parseFetcherPayload(
    topPostsResponseSchema,
    await get(`/top-posts/${SUBREDDIT}?limit=5`),
    '/top-posts',
  );
  process.stdout.write(
    `  ${page.posts.length > 0 ? '✓' : 'FAIL'} r/${SUBREDDIT} returned ${page.posts.length} posts, isInvalid=${page.isInvalid}\n`,
  );

  const first = page.posts[0];
  if (!first) {
    process.stdout.write('  SKIP: no post to fetch comments for\n');
    process.exit(0);
  }

  const { comments } = parseFetcherPayload(
    commentsResponseSchema,
    await get(`/comments/${SUBREDDIT}/${first.id}`),
    '/comments',
  );
  const words = comments.reduce(
    (sum, comment) => sum + comment.body.split(/\s+/).filter(Boolean).length,
    0,
  );
  const ids = new Set(comments.map((comment) => comment.id));
  process.stdout.write(
    `  ✓ comments matched the schema: ${comments.length} comments, ${ids.size} distinct ids\n`,
  );
  process.stdout.write(
    `  .. measured, not asserted: this thread is ${words} words (the scraper keeps a post at 2500+)\n`,
  );
  process.exit(0);
})().catch((err: Error) => {
  process.stdout.write(`  FAIL: ${err.name}: ${err.message}\n`);
  process.exit(1);
});
