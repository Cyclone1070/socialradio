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

// A wrong answer is a contract break and has to fail the run. Availability is
// not: reddit blocks datacenter IPs and rate-limits, which is what skip() is for.
let failures = 0;
const check = (held: boolean, msg: string): void => {
  if (held) {
    process.stdout.write(`  OK   - ${msg}\n`);
  } else {
    failures++;
    process.stdout.write(`  FAIL - ${msg}\n`);
  }
};

const get = async (path: string): Promise<unknown> => {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`);
  } catch (err) {
    return skip(`fetcher or reddit unreachable (${(err as Error).message})`);
  }
  if (!res.ok) {
    throw new Error(`fetcher answered ${res.status} for ${path}`);
  }
  return res.json();
};

(async () => {
  if (!base) {
    skip('REDDIT_FETCHER_URL is not set — point it at a running fetcher');
  }

  const present = parseFetcherPayload(
    existsResponseSchema,
    await get(`/exists/${SUBREDDIT}`),
    '/exists',
  );
  check(
    present.valid,
    `r/${SUBREDDIT} reports valid=${present.valid}`,
  );

  const absent = parseFetcherPayload(
    existsResponseSchema,
    await get(`/exists/${IMPOSSIBLE}`),
    '/exists',
  );
  check(
    !absent.valid,
    `a name that cannot exist reports valid=${absent.valid}`,
  );

  const page = parseFetcherPayload(
    topPostsResponseSchema,
    await get(`/top-posts/${SUBREDDIT}?limit=5`),
    '/top-posts',
  );
  check(
    page.posts.length > 0,
    `r/${SUBREDDIT} returned ${page.posts.length} posts, isInvalid=${page.isInvalid}`,
  );

  const first = page.posts[0];
  if (!first) {
    process.stdout.write('  SKIP: no post to fetch comments for\n');
    process.exit(failures === 0 ? 0 : 1);
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
  check(
    comments.length > 0,
    `r/${SUBREDDIT} post ${first.id} returned ${comments.length} comments`,
  );
  check(
    ids.size === comments.length,
    `comment ids are distinct (${ids.size}/${comments.length})`,
  );
  process.stdout.write(
    `  .. measured, not asserted: this thread is ${words} words (the scraper keeps a post at 2500+)\n`,
  );
  process.stdout.write(
    `\ncontract probes: ${failures === 0 ? 'all answered as required' : `${failures} wrong`}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
})().catch((err: Error) => {
  process.stdout.write(`  FAIL: ${err.name}: ${err.message}\n`);
  process.exit(1);
});
