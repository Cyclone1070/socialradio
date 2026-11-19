// Route-level probe: drives a running fetcher's /comments endpoint and checks the
// payload shape the backend consumes.
//   REDDIT_FETCHER_URL=http://localhost:3001 node scripts/route-probe.mjs webscraping 1xys320
const base = process.env.REDDIT_FETCHER_URL;
const [subreddit, postId] = process.argv.slice(2);

if (!base || !subreddit || !postId) {
  console.error(
    'usage: REDDIT_FETCHER_URL=http://host:port node scripts/route-probe.mjs <subreddit> <postId>',
  );
  process.exit(2);
}

const startedAt = Date.now();
const response = await fetch(
  `${base}/comments/${encodeURIComponent(subreddit)}/${encodeURIComponent(postId)}`,
);
const body = await response.json();
const comments = Array.isArray(body.comments) ? body.comments : [];
const elapsedMs = Date.now() - startedAt;
const required = ['id', 'body', 'author', 'score', 'parent_id', 'created_utc'];

const schemaOk = comments.every(
  (comment) =>
    required.every((key) => key in comment) &&
    typeof comment.id === 'string' &&
    comment.id.length > 0 &&
    typeof comment.body === 'string' &&
    typeof comment.author === 'string' &&
    Number.isInteger(comment.score) &&
    Number.isInteger(comment.created_utc) &&
    typeof comment.parent_id === 'string' &&
    comment.parent_id.length > 0,
);

const ids = new Set(comments.map((comment) => comment.id));
const byId = new Map(comments.map((comment) => [comment.id, comment]));
const chainLength = (comment) => {
  let length = 1;
  let current = comment;
  let guard = 0;
  while (
    current &&
    current.parent_id !== postId &&
    byId.has(current.parent_id) &&
    guard++ < 50
  ) {
    length += 1;
    current = byId.get(current.parent_id);
  }
  return length;
};

console.log(
  JSON.stringify(
    {
      status: response.status,
      count: comments.length,
      unique: ids.size,
      elapsedMs,
      maxParentChain: Math.max(0, ...comments.map(chainLength)),
      schemaOk,
      first: comments[0] ?? null,
    },
    null,
    2,
  ),
);

process.exit(response.ok && schemaOk && comments.length > 0 ? 0 : 1);
