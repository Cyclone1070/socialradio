// Full-subreddit live smoke: listing + comments until 20 valid posts.
// Requires the fetcher on :3013 and browserless for the listing.
//   node scripts/full-sub-smoke.mjs AskReddit
// Exits non-zero on any failed request, a 429, or fewer than 20 valid posts.
const subreddit = process.argv[2] ?? 'AskReddit';
const base = process.env.FETCHER_URL ?? 'http://127.0.0.1:3013';
const target = Number(process.env.FULL_SUB_TARGET ?? 20);
const started = Date.now();

const json = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}: ${body.slice(0, 200)}`);
  return JSON.parse(body);
};

try {
  const listing = await json(`${base}/top-posts/${subreddit}?limit=100`);
  console.log(JSON.stringify({ phase: 'listing', posts: listing.posts.length, ms: Date.now() - started }));
  let considered = 0;
  let valid = 0;
  let comments = 0;
  let words = 0;
  for (const post of listing.posts) {
    if (valid >= target || considered >= 100) break;
    considered += 1;
    const startedPost = Date.now();
    const data = await json(`${base}/comments/${subreddit}/${post.id}`);
    const postComments = data.comments ?? [];
    const postWords = postComments.reduce(
      (sum, comment) => sum + (comment.body ?? '').trim().split(/\s+/).filter(Boolean).length,
      0,
    );
    comments += postComments.length;
    words += postWords;
    if (postWords >= 2_500) valid += 1;
    console.log(JSON.stringify({ post: post.id, ms: Date.now() - startedPost, comments: postComments.length, words: postWords, valid, considered }));
  }
  const result = { done: true, elapsedMs: Date.now() - started, considered, valid, comments, words };
  console.log(JSON.stringify(result));
  if (valid < target) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({ done: false, error: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - started }));
  process.exitCode = 1;
}
