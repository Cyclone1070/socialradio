# reddit-fetcher

Small HTTP service that renders Reddit pages in browserless and returns posts and
comments for the socialradio backend. Reddit blocks anonymous `.json`, so every
endpoint reads the rendered DOM instead.

## Endpoints

| Route | Returns |
| --- | --- |
| `GET /top-posts/:subreddit?limit=N` | Rendered weekly top posts; `after` is always `null` |
| `GET /comments/:subreddit/:postId` | Rendered comment tree, expanded in place |
| `GET /exists/:subreddit` | `{ valid: boolean }` from the rendered community shell |

## Environment

| Variable | Purpose |
| --- | --- |
| `BROWSERLESS_WS_URL` | Playwright WebSocket endpoint, e.g. `ws://localhost:4000/playwright?timeout=300000` |
| `PORT` | HTTP port (defaults to 3000) |
| `LOG_LEVEL` | Pino level (defaults to `info`) |

## Commands

```
npm run build    # tsc to dist/
npm run start    # node dist/server.js
npm test         # jest
npm run gate     # prettier + eslint + tsc + jest
```

## Layout

| File | Responsibility |
| --- | --- |
| `src/browser-session.ts` | Browserless connection, per-subreddit context cache, reconnect policy, `evaluateSafely` |
| `src/scraper.ts` | Endpoints: top posts, existence, comments; continuation orchestration |
| `src/app.ts`, `src/server.ts` | Express routes and process startup |
| `src/pacer.ts` | Per-host request pacing |
| `src/dom.ts` | Page scripts injected with `page.evaluate`; must stay import-free (ESLint enforces it) |
| `src/comments.ts` | Comment parsing, reparenting, cap and dedupe |
| `src/comment-collection.ts` | Expansion loop: batch clicks, growth waits, deadline |
| `src/posts.ts` | `shreddit-post` parser |
| `src/continuation-budget.ts` | Pure time-budget planning for continuation pages |
| `src/timeout.ts` | `withTimeout` helper |
| `src/types.ts` | Public post/comment shapes |

Tests are colocated (`*.spec.ts`); the repository's architecture spec enforces the
one-spec-per-implementation naming.

## Probes

These talk to the live service and require a fresh build (`scripts/preflight.mjs`
refuses to run against a stale `dist/`):

```
node scripts/route-probe.mjs <subreddit> <postId>
node scripts/live-qa.mjs <subreddit> <postId>
node scripts/verify-text.mjs <subreddit> <postId>
```

The shared contract probe lives at `deployment/tests/contracts/reddit-contract.ts`
in the repository root and exercises all three endpoints.

## Live regression harness

`scripts/regression.mjs` exercises the built HTTP API against fixed posts and
compares correctness plus wall time with `scripts/regression-baseline.json`.

```bash
# with browserless and the fetcher running on :3013
FETCHER_URL=http://127.0.0.1:3013 npm run regression:record
FETCHER_URL=http://127.0.0.1:3013 npm run regression:check
```

The check fails on any non-200/429, invalid or duplicate comments, broken
parents, less than 90% of baseline comments or words, or a catastrophic
slowdown. The checked-in baseline is the rendered path (embed disabled). `npm run smoke:sub -- AskReddit` additionally walks the real listing
and requires 20 valid posts; it is the end-to-end 20-save smoke rather than a
four-post microbenchmark. The time gate is deliberately loose (`REGRESSION_TIME_CEILING=2.5`
and `REGRESSION_ABSOLUTE_MAX_MS=90000`) because Reddit's render time is the
dominant variable; use the logged phase profile and `live-qa.mjs` for
algorithmic latency comparisons.

`scripts/live-qa.mjs` also accepts `LIVE_QA_MIN_COMMENTS`,
`LIVE_QA_MIN_WORDS`, `LIVE_QA_MAX_MS`, and `--manual`; it exits non-zero on
any 429 or failed gate.

## Comment cap and word guard

The rendered collector stops at `REDDIT_COMMENT_SOFT_CAP` (default 250) when
the comments collected so far already clear the 2,500-word validity guard. If
the soft cap is reached below 2,500 words it resumes collecting to the hard
cap of 500. This keeps the validity contract while avoiding a full 500-comment
expansion on every high-volume thread. On the live 20-post smoke this reduced
the subreddit wall time from roughly 15–18 minutes (500-comment path) to
6–7 minutes, with all 20 posts valid.

The rendered path is also guarded against partial renders: a thread advertising
hundreds of comments but exposing only 25 with no controls is retried once on
a fresh context rather than being returned as a short thread. A page that stops
growing while controls remain, a JS-challenge interstitial, and a browserless
request timeout are all retried once through the reconnect policy.

## Comment source: server-rendered embed

`REDDIT_EMBED_COMMENTS` (default `false`; experimental) fetches Reddit's public
`/r/<sub>/comments/<id>/.embed?limit=500` view before opening Chromium. It is
server-rendered and costs one rate-limit unit per post, versus roughly nine
units and 15–25s for a hydrated comment page. The parser extracts the same
public fields (id, body, author, score, parent, relative timestamp), strips
image-preview URLs, dedupes, caps at 500, and falls back to Chromium when the
embed request fails or returns fewer than 2,500 words.

Caveats: the embed's timestamps are relative (`6 days ago`), so `created_utc`
is approximate; the embed is a Reddit legacy surface and can change without
notice. The rendered browser path is the default and the source of truth. The embed
path is disabled unless explicitly enabled because it is undocumented and the
official embed is preview-only.

## Safe settings discovered by live testing

- Keep `GROWTH_TIMEOUT_MS = 2000`: lowering it to 1200 lost a comment.
- Keep the soft cap at 250 for latency; the hard-cap resume protects the word
  guard on low-density threads.
- Do not add a fixed post-click sleep; growth is event-driven and the final
  tree is re-read.
- Do not abort image/font/media requests: Reddit stopped rendering comments.
- Do not raise `CLICK_BATCH` above 32: large batches slowed hydration.
- Do not run two full comment scrapes through one browserless instance on this
  host: page evaluations timed out.
- Keep the embed hard timeout: a stalled embed connection must fall back rather
  than hold the request for minutes.
