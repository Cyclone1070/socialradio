# Findings: scraping completeness and latency

## Stage 0 — Investigation

### Latency breakdown

Measured with a probe that injects a counting sleep into `collectComments` (same code as
production, `dist` build):

| Thread | Returned | Clicks | Settle time | Total | Settle share |
|---|---|---|---|---|---|
| R1 askreddit/1xuw9sz (60 s budget) | 271 | 49 | 44.1 s | 68.9 s | 64% |
| R3 webscraping/1xys320 | 40 | 7 | 6.3 s | 17.0 s | 37% |

The fixed `CLICK_SETTLE_MS = 900` after every click is the dominant cost on large threads.
A public-path R1 run with the 80 s budget took 74.5 s for 295 comments, so the settle
accounts for roughly 40 s of a full scrape.

### Top page

- `/r/{sub}/top/?t=week` renders **3 `shreddit-post` elements initially** on both
  `r/webscraping` and `r/askreddit`.
- Scrolling loads more via `POST /svc/shreddit/community-more-posts/top/...`:
  `r/askreddit` went 3 → 27 → 52 posts after two scrolls.
- There is **no next-page button or link**; pagination is infinite scroll only.
- `r/test` has only 3 posts for the week, so `limit=5` can legitimately return 3.
- Post attributes available on each `shreddit-post`:
  `id` (`t3_...`), `post-title`, `score`, `author`, `created-timestamp` (ISO with offset),
  `permalink`, `post-type`, `domain`, `comment-count`, `post-language`.
- `selftext` is not exposed as an attribute; `shreddit-post-text-body` was absent on the
  sampled AskReddit posts. The endpoint will return `selftext: ''` when the body is not
  rendered as an element.

### Existence markers

| Page | Status | `shreddit-feed` | `shreddit-subreddit-header` | Posts | Body |
|---|---|---|---|---|---|
| `r/webscraping` | 200 | present | present | 3 | normal community page |
| `r/this_subreddit_cannot_exist_9f3a2b` | 200 | absent | absent | 0 | mature-content/login interstitial, no community chrome |

The impossible subreddit does **not** 404. Detection must use the presence of the feed or
community header, not the status code.

### Forbidden page

`#shreddit-forbidden` was the marker in the earlier extraction investigation; the same
check will be used to fail loudly (FR-R4).

### Thread matrix (to run in Stage 4)

- Small: a thread with fewer than 25 comments.
- Locked: a locked announcement thread.
- Deleted-heavy: a thread with `[deleted]` bodies.
- Non-English: a subreddit whose UI language is not English.

## Stage 1 — Event-driven waits (in progress)

### CSP blocks waitForFunction

Reddit's Content-Security-Policy refuses `eval` (`EvalError: Refused to evaluate a
string as JavaScript because 'unsafe-eval' is not an allowed source`). Playwright's
`page.waitForFunction` is implemented with an eval-like poll, so both the original
25-comment wait and the first growth-wait attempt failed **silently** (the `catch`
swallowed it). This also means the old 25-render guarantee never actually ran against
Reddit.

Replacement: `page.evaluate` with a Promise driven by `MutationObserver`
(`waitForCommentGrowth`, `waitForStableTree` in `dom.ts`), which is not blocked by CSP.

### Batched clicks

Sequential clicking costs one Reddit round-trip per batch (~0.5–1.2 s). Clicking 8
unmarked "more replies" buttons per round and waiting once for growth raises throughput:
a probe reached 475 comments in 41.6 s versus 317 in 76 s sequentially.

Production now uses `clickMoreRepliesBatch` (8 per round, buttons marked with
`data-qa-clicked`), a 1.5 s growth timeout, and skips continuation pages when the cap is
already met.

### Measured (public route, 80 s budget)

| Run | Comments | Wall time | Notes |
|---|---|---|---|
| R1 askreddit/1xuw9sz | 470 | 75.1 s | 450 inline + continuation pages |
| R1 (earlier, sequential) | 317 | 76.0 s | before batching |
| R3 collector only | 37 | 7.3 s | growth waits 91–1018 ms |

The inline phase is now fast; the remaining cost on R1 is the continuation phase
(up to 8 pages, ~4 s each). AC-1's 45 s target is **not met yet**; the next step is to
parallelize continuation pages or stop inline expansion earlier.

### Tests

- `dom.spec.ts`: growth wait (append → true, timeout → false), stable tree, batch click
  (marks, skips marked, ignores anchors).
- `comment-collection.spec.ts`: no fixed sleep, batch click, skip continuations at cap.
- Fetcher gate: 8 suites / 63 tests, exit 0.

## Stage 2/3 — Rendered top posts and existence

- `parseTopPosts` reads `shreddit-post` attributes: `id` (`t3_` stripped), `post-title`,
  `author`, `score`, `created-timestamp`; `selftext` is `''` because the body is not an
  attribute.
- `fetchTopPosts` renders `/r/{sub}/top/?t=week`, waits for the first post, scrolls while
  the rendered count is below `limit` and the 20 s budget allows, and returns
  `after: null` (no next-page control exists).
- `exists` renders the subreddit and returns whether the page contains `shreddit-feed`
  or `shreddit-subreddit-header`; a missing subreddit answers HTTP 200 without either.
- Live: `/top-posts/test?limit=5` returned 3 posts in 9.8 s (`r/test` has 3 for the week);
  `/exists/test` → true; `/exists/this_subreddit_cannot_exist_9f3a2b` → false.
- Shared contract probe: all three probes OK, exit 0 (`r/test` 3 posts, 25 comments for
  the first post).
- Forbidden pages (`#shreddit-forbidden`) now throw, so the comments route answers 502
  instead of an empty success.

## Stage 5 — Text verification

`scripts/verify-text.mjs` fetched the API output and independently expanded the same
thread, then compared normalized body text for the top 20 comments:
20 compared, **0 mismatches**. In that run the API returned 25 comments while the page
rendered 43, so the comparison covered the overlap; the count difference is the
early-stop issue below.

## Remaining before audit

- R3 latency is 43 s (target ≤ 20 s): continuation pages dominate and contribute almost
  nothing when the inline tree already has a deep chain. Planned fix: skip continuations
  when the inline max parent chain is already ≥ 3.
- R3 returned 37 comments on the route (manual sees 39 inline): batch marking may skip a
  control that paginates. Needs a targeted fix and a re-measure.
- Robustness matrix (small, locked, deleted, non-English) not yet run live.
- Fetcher gate: 9 suites / 71 tests, exit 0.

## Final measurements (Stage 4)

| Check | Result |
|---|---|
| R1 askreddit/1xuw9sz | 417 comments, 41.9 s (public route) |
| R3 webscraping/1xys320 | 53 comments, 13.6 s (public route) |
| Small thread webscraping/1xukkss | 17 comments, 7.2 s |
| Non-English r/de/1xua7jl | 44 comments, 9.7 s |
| Top posts r/test limit 5 | 3 posts, 9.8 s (r/test has 3 for the week) |
| Top posts r/askreddit limit 5 | 5 posts, 11.9 s |
| Exists | `/exists/test` true, impossible name false |
| Contract probe | `/exists`, `/top-posts`, `/comments` all OK, exit 0 |
| Text verification R3 | API 53, page 53, 20 compared, 0 mismatches |
| Fetcher gate | 9 suites / 77 tests, exit 0 (superseded: 83 tests) |

Implementation notes:

- The inline collection budget is a 36 s wall-clock window from call start; the
  collector checks the deadline before and after each click batch, so the tail overshoot
  is one batch.
- Buttons are marked `data-qa-clicked`; the loop stops when a pass finds no unmarked
  control, with a 1 s late-growth grace so delayed renders are not missed.
- Continuations are skipped when inline comments already reach 200, when the cap is met,
  or when the inline max parent chain is at least 5 (round 4).
- Deleted comments are kept because their body and author are `[deleted]` (non-empty);
  a unit test locks this in. Locked threads have no separate code path; the parser only
  reads rendered comment elements.
- Forbidden pages throw, so `/comments` answers 502 instead of an empty success.

## Audit fixes

- `/exists` race: the first read happened right after `domcontentloaded` and could see an
  empty shell. It now reads, and on an invalid result waits up to 5 s for
  `shreddit-feed`/`shreddit-subreddit-header` and reads once more. Live first calls:
  `test`, `webscraping`, `javascript` → true; impossible name → false.
- Redirect guard: `fetchPostComments` now checks `page.url()` contains
  `/r/{subreddit}/comments/{postId}` and throws otherwise. A live invalid thread id
  returned 502 instead of another subreddit's comments.
- `live-qa.mjs` was stale (`clickMore`, `waitForFunction`, fixed waits). It now uses
  `clickMoreBatch`, `waitForCommentGrowth`, `waitForStableTree`, and the production skip
  rules. R3: 55 comments, 18.6 s, 0 `.json` requests, chain 5.
- AC-7 is scoped to a thread with fewer than 25 comments (live: 17 in 7.2 s); AC-8 now
  also cites the live 502.

## Audit round 2 fixes

- Contract probe now fails on any non-2xx (5xx no longer skipped), asserts
  `/exists/test` is true, and asserts the comments list is non-empty with distinct ids.
  Live run: 5 OK lines, exit 0.
- `verify-text.mjs` now rejects a non-2xx response, refuses an empty comment list, and
  requires at least `min(20, apiCount)` comparisons. It reads rendered `innerText`.
  Live: 20 compared, 0 mismatches, exit 0.
- The stricter text check exposed a real bug: block paragraphs were concatenated without
  a space (`api.I am`). Bodies now join block-level content with spaces; a unit test
  locks it in.
- FR-R5: a failed initial tree read now throws instead of returning `[]`; the scraper
  test asserts the rejection.
- FR-L3: the completion log now carries `loadMs`, `expansionMs`, `continuationMs` and
  `ms`.
- AC-8: `isForbiddenPage` also detects a password form when no comment rendered; DOM
  tests cover both markers.
- `live-qa.mjs` passes `minInlineForContinuations` and
  `continuationsOnlyBelowChainDepth` (lines 105-106) and uses the observer waits.
- Fetcher gate: 9 suites / 81 tests, exit 0 (superseded: 83 tests).

## Round 3 fixes (supersedes earlier counts)

- A page without `#comment-tree` now throws (`comment tree not rendered`); an empty tree
  (tree present, zero comments) still returns an empty snapshot. Superseded by round 4.
- The collector checks the deadline after each read as well as before it.
- `/top-posts` passes its 20 s budget into `goto` and the selector wait; continuations
  are bounded to 45 s from call start.
- Continuations are skipped only when the inline chain is at least 5 deep (was 3), so
  deep threads still get their continuation pages when the inline tree is shallow.
- `parseTopPosts` reads `[slot="text-body"]` when the feed carries the post body.
- `verify-text.mjs` now requires at least 20 comments and exactly 20 comparisons.
- A new integration test drives a forbidden fixture through `fetchPostComments` and the
  real `/comments` route and asserts 502.
- Gates: fetcher 9 suites / 83 tests; root gate green.
- Final live: R1 417/41.9 s, R2 473/43.4 s (chain 5), R3 55/13.6 s; contract probe all
  OK; text verification 55 API / 55 rendered, 20 compared, 0 mismatches.

## Round 4 (audit blocker closed)

- `readCommentTree` now requires `#comment-tree` and throws `comment tree not rendered`
  when it is absent; a genuine empty thread (tree present, zero comments) returns an
  empty snapshot. The previous post-only exception was the last FR-R5 silent path.
- The forbidden tests now execute the real `isForbiddenPage` against fixture documents
  (marker and password wall) rather than returning `true`; the route test drives a
  password-wall fixture through `fetchPostComments` and `/comments` and asserts 502.
- `parseTopPosts` joins `p`/`li` children of `[slot="text-body"]` with spaces; test added.
- Deadline-after-read is covered by an injected clock; a `[removed]` body test sits next
  to the `[deleted]` one.
- `live-qa.mjs` uses the production chain threshold (5).
- Test counts: see the final gate line below (this supersedes 77/81/83 mentions).

Final gates on the round-4 tree: reddit-fetcher 9 suites / 86 tests, exit 0; repository
46 suites / 322 tests plus 7 CLI suites / 42 tests, exit 0.

## Single-thread latency pass

Measured on webscraping/1xys320 (33 comments at the time; API and independent page
expansion agree on 33, 0 text mismatches).

Before: ~12.9 s total, load 7.5 s, expansion 5.3 s.

After:
- Expansion reads only the comment count per round and serializes the tree once at
  the end (`readCommentCount`, `comment-collection.ts`).
- Clicks are gated on the `/svc/shreddit/more-comments` responses via
  `MoreCommentsTracker`, instead of a fixed growth wait.
- Growth waits trimmed (800 ms) and the final no-control wait to 300 ms.
- The page is scrolled once after `body` attaches, which starts Reddit's comment
  render earlier; navigation uses `commit` and the selector waits for `attached`.

Result: 7.6–10.0 s total, load 5.8–7.0 s (selector 5.0–6.2 s of that is Reddit's own
comment render), expansion 1.8–3.0 s. The remaining load time is the page's client-side
render; going below it means leaving the rendered-DOM approach.

Correctness coverage added: golden fixture for exact words (paragraphs, links, inline
code, emoji, non-English), hierarchy (including deleted/removed replies), and per-comment
author/score/timestamp; a 30-deep invariant test (unique ids, parent exists, order); a
count-reader test; and the live verifier now compares body, author and parent id, not
just text.
