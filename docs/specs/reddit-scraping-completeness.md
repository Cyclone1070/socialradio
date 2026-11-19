# Reddit scraping completeness and latency

Status: draft for audit.
Builds on: `reddit-comment-extraction.md` (FR-1..FR-13, AC-1..AC-15).

## 1. Context

The comment extractor works on three reference threads, but three problems remain:

1. **Latency.** Every expansion click is followed by a fixed `CLICK_SETTLE_MS = 900`
   sleep, and the initial render waits on a fixed 25-comment threshold with a 5 s cap.
   On R1 that is tens of seconds spent waiting for work that has often already finished.
2. **Broken endpoints.** `/top-posts` and `/exists` still call Reddit's `.json` endpoints
   from inside the page. Reddit blocks anonymous `.json`, so `/top-posts` fails the shared
   contract probe (`r/test returned 0 posts, isInvalid=true`).
3. **Unproven breadth and text fidelity.** Only three threads were exercised, edge cases
   (small, locked, deleted, forbidden) are undefined, and no one compared the returned
   text with what the rendered page actually shows.

## 2. Goal

All three fetcher endpoints return correct data from rendered pages, comment extraction
waits on events instead of fixed sleeps, edge-thread behaviour is defined and tested, and
the returned text is verified against the rendered page.

## 3. Definitions

- **Event-driven wait** — resolving on a DOM condition (comment count grew, tree stable)
  or a network response, not on a fixed delay.
- **Settle** — the current fixed 900 ms delay after a click.
- **Stable tree** — the comment count has not changed for a short quiet window
  (target 250 ms), measured by polling a counter; not a fixed wait before reading.
- **Forbidden page** — a page containing `#shreddit-forbidden` or a login/interstitial
  wall instead of the requested content.

## 4. Functional requirements

### Latency

- **FR-L1 — No fixed settle.** Comment expansion must not sleep for a fixed duration after
  a click. After clicking, wait until the rendered comment count increases, or until a
  bounded no-growth timeout (≤ 2 s) proves the click produced nothing.
- **FR-L2 — Adaptive initial wait.** The initial render wait resolves when the comment tree
  is stable (quiet window), not when an arbitrary count is reached. A thread with fewer
  than 25 comments must not wait for the 5 s cap.
- **FR-L3 — Phase timings.** One log line per extraction includes load, expansion,
  continuation and total milliseconds.

### Top posts and existence

- **FR-T1 — Rendered top posts.** `/top-posts/:subreddit` returns up to `limit` posts
  (default 100) parsed from the rendered top page (`shreddit-post`), scrolling to load
  more while needed and within a 20 s budget. Fields: `id, title, selftext, author, score,
  created_utc`. `selftext` is `''` when the body is not rendered as an element. No `.json`
  request on this path.
- **FR-T2 — Pagination.** The rendered top page exposes no next-page control (infinite
  scroll only), so `after` is accepted but not honoured: the endpoint returns
  `after: null` and the current top posts rather than inventing a cursor.
- **FR-T3 — Invalid subreddit.** A missing subreddit returns `{posts: [], after: null,
  isInvalid: true}`; an existing one returns `isInvalid: false` even when the page has no
  qualifying posts.
- **FR-T4 — Existence.** `/exists/:subreddit` returns true for an existing public
  subreddit and false for one that cannot exist, from the rendered page; no `.json`.

### Robustness

- **FR-R1 — Small threads.** A thread with fewer than 25 comments returns all of them and
  does not wait for the 25-comment threshold.
- **FR-R2 — Locked threads.** A locked thread returns its comments; lock state does not
  change parsing.
- **FR-R3 — Deleted and removed comments.** A comment whose rendered body is `[deleted]`
  or `[removed]` is returned with that body and its author (usually `[deleted]`), not
  dropped. Comments with an empty body are still dropped (FR-12 of the base spec).
- **FR-R4 — Forbidden pages.** If the thread page is a forbidden/login wall, extraction
  fails loudly (route returns 502) instead of returning an empty success.
- **FR-R5 — No silent empty on transport failure.** If the initial navigation or render
  fails, extraction fails loudly; an empty array means the thread genuinely has no text
  comments.

### Text verification

- **FR-V1 — Text parity.** A verification script renders the thread, expands it, extracts
  the same comments the fetcher returns, and compares normalized body text for the top 20
  by score. Zero mismatches on R3.

## 5. Non-functional requirements

- **NFR-1 — Latency target.** R1 (≥ 200 comments) completes in ≤ 45 s wall time, down from
  74.5 s; R3 completes in ≤ 20 s, down from 38.3 s.
- **NFR-2 — No fixed sleeps in the comment path.** A unit test proves that when the count
  grows immediately after a click, the collector does not call a sleep.
- **NFR-3 — Top posts latency.** 5 posts in ≤ 20 s on a live run.
- **NFR-4 — Gates.** Fetcher and repository gates stay green.
- **NFR-5 — Contract probe.** The shared `reddit-contract.ts` passes `/exists`,
  `/top-posts` and `/comments` against a live fetcher.

## 6. Acceptance criteria

- **AC-1** R1 returns ≥ 200 comments in ≤ 45 s (public route, measured).
- **AC-2** R3 returns at least 39 comments in ≤ 20 s (public route, measured).
- **AC-3** No fixed settle remains: a unit test with an immediately growing count shows
  zero sleep calls; source has no `CLICK_SETTLE_MS`.
- **AC-4** `/top-posts/test?limit=5` returns 1–5 schema-valid posts (r/test has 3 for the
  week) with `isInvalid=false`, and `/top-posts/askreddit?limit=5` returns 5 posts after
  scrolling; no `.json` request observed.
- **AC-5** `/exists/test` is true and `/exists/this_subreddit_cannot_exist_9f3a2b` is
  false on a live fetcher; no `.json` request observed.
- **AC-6** `reddit-contract.ts` reports all three probes OK.
- **AC-7** A thread with fewer than 25 comments returns all of them without waiting for
  the old 25-comment threshold (unit test and live run: 17 comments in 7.2 s).
- **AC-8** A forbidden page or login wall produces a 502 from `/comments`, not
  `{comments: []}` (DOM fixture tests plus a route test whose scraper rejects).
- **AC-9** Text verification on R3: 20 comments compared, 0 mismatches.
- **AC-10** Both gates green; neutral audit PASS.

## 7. Verification plan

- Unit tests per TDD cycle (jsdom fixtures for parsing, fake pages for waits).
- Live: R1, R2, R3 through the public route; small/locked/deleted threads chosen in
  Stage 0.
- `reddit-contract.ts` against a running fetcher.
- `scripts/verify-text.mjs` for FR-V1.
- Findings recorded in `reddit-scraping-completeness-findings.md`.

## 8. Out of scope

- NSFW, quarantined and private subreddits (login required).
- Legacy and mobile Reddit markup.
- Comment counts beyond the 80 s budget.
- Backend schema changes.

## 9. Risks

- Reddit's rendered top page may paginate by infinite scroll only; FR-T2 allows
  `after: null` when no control exists.
- Event-driven waits can miss delayed renders; the bounded no-growth timeout is the
  fallback.
- Fewer comments may be collected in less time; AC-1 keeps the ≥ 200 floor.
