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
