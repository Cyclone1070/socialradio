/**
 * Tier 1 mock for the reddit fetcher.
 *
 * The app reaches scraping through REDDIT_FETCHER_URL, so pointing that here
 * keeps every layer above it - the HTTP client, the DTO mapping, the scraper,
 * the pool logic and the database - exactly as production, while nothing
 * touches reddit and no browser is needed.
 *
 * Payloads mirror the fetcher's own contract (reddit-fetcher/src/types.ts and
 * its routes): { posts, after, isInvalid }, { comments } and { valid }.
 */
import { createServer, ServerResponse } from 'node:http';
import {
  comments as buildComments,
  invalidPage,
  topPosts as buildTopPosts,
} from './fetcher-payloads.ts';

const PORT = Number(process.env.FETCHER_MOCK_PORT ?? 4011);
const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** A subreddit whose name says it is gone behaves like one that no longer exists. */
const isGone = (name: string): boolean => /dead|invalid|nonexistent|banned|fake/i.test(name);

const json = (res: ServerResponse, status: number, payload: string): void => {
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const [route, subreddit, postId] = url.pathname.split('/').filter(Boolean);
  process.stdout.write(`${req.method} ${url.pathname}${url.search}\n`);

  if (route === 'top-posts') {
    const payload = isGone(subreddit ?? '')
      ? invalidPage()
      : buildTopPosts(nowSeconds());
    return json(res, 200, JSON.stringify(payload));
  }

  if (route === 'comments') {
    const payload = { comments: buildComments(postId ?? 'unknown', nowSeconds()) };
    return json(res, 200, JSON.stringify(payload));
  }

  if (route === 'exists') {
    return json(res, 200, JSON.stringify({ valid: !isGone(subreddit ?? '') }));
  }

  json(res, 404, JSON.stringify({ error: `no mock route for ${url.pathname}` }));
}).listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`fetcher mock listening on ${PORT}\n`);
});
