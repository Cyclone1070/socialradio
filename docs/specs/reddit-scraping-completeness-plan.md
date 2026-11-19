# Plan: scraping completeness and latency

Status: draft.
Spec: `reddit-scraping-completeness.md`.
Method: RED → verify failure → minimal GREEN → refactor, per cycle.

## Stage 0 — Investigation (no production code)

- **0.1 Latency breakdown.** Instrument a live R1 and R3 run: navigation, initial render
  wait, click+settle total, continuation total. Record how much wall time the 900 ms
  settle accounts for.
- **0.2 Top-page DOM.** On `r/test/top/?t=week`, record: `shreddit-post` attributes
  (`id`, `post-title`, `score`, `author`, `created-timestamp`, `permalink`), how selftext
  appears, the next-page control (button/link/infinite scroll), and markers for a missing
  subreddit (`#shreddit-forbidden`, 404 page, "there doesn't seem to be anything here").
- **0.3 Exists markers.** Compare an existing sub, an impossible sub and a forbidden page:
  status code, title, and stable selectors that distinguish them.
- **0.4 Thread matrix.** Pick live threads: small (< 25 comments), locked, deleted-heavy,
  non-English. Record URLs and expected counts.
- **0.5 Findings.** Write `reddit-scraping-completeness-findings.md` with measurements and
  selectors. Gate: if the top page cannot be parsed without `.json`, stop and amend the
  spec before coding.

## Stage 1 — Event-driven comment waits

- **1.1 Growth wait.** New reader method `waitForGrowth(previousCount, timeoutMs)` backed
  by `page.waitForFunction` on `shreddit-comment` count; collector calls it after a click
  instead of sleeping.
  RED: collector calls sleep 900 ms even when the count grew immediately.
- **1.2 No-growth timeout.** When the click produces nothing, the wait resolves false after
  ≤ 2 s; three stale rounds still stop the loop.
  RED: collector hangs or stops after a fixed sleep.
- **1.3 Stable initial wait.** Replace the fixed 25-comment wait with a stable-tree wait
  (quiet window 250 ms) that resolves for a 10-comment thread without the 5 s cap.
  RED: 10-comment thread waits the full 5 s.
- **1.4 Wire-up.** `scraper.ts` uses the new waits; `CLICK_SETTLE_MS` is deleted; phase
  timings are logged.
  RED: source still contains a fixed settle; log lacks phase timings.
- **1.5 Measure.** Live R1 ≤ 45 s with ≥ 200 comments; R3 ≤ 20 s with 39.

## Stage 2 — Rendered top posts

- **2.1 Parser.** `parseTopPosts(html)` with jsdom: id, title, selftext, author, score,
  created_utc, in render order.
  RED: module missing.
- **2.2 Cursor.** Detect the next-page control and return its cursor/href; `null` when
  absent.
  RED: always null.
- **2.3 Invalid detection.** Missing subreddit yields `isInvalid: true`.
  RED: returns empty posts with `isInvalid: false`.
- **2.4 Scraper.** `fetchTopPosts` renders `/r/{sub}/top/?t=week`, applies `limit`, follows
  one page when `after` is supplied, never calls `.json`.
  RED: current implementation still fetches `.json`.
- **2.5 Contract.** Live `/top-posts/test?limit=5` returns ≥ 5 posts, `isInvalid=false`.

## Stage 3 — Rendered existence

- **3.1 Detection.** `isExistingSubreddit(html, status)` pure function with fixtures for
  existing, missing and forbidden pages.
  RED: module missing.
- **3.2 Scraper.** `exists` renders the subreddit page and uses the detector; no `.json`.
  RED: current implementation still fetches `.json`.
- **3.3 Live.** `/exists/test` true, impossible name false.

## Stage 4 — Robustness and failure modes

- **4.1 Forbidden.** Detect `#shreddit-forbidden`/login wall after navigation; throw so the
  route answers 502.
  RED: returns `{comments: []}`.
- **4.2 Edge threads.** Small, locked, deleted-heavy and non-English threads: fixtures plus
  one live run each; deleted bodies kept, empty bodies dropped.
  RED: small thread waits for 25; deleted body dropped.
- **4.3 Transport failure.** A failed navigation or render throws instead of returning an
  empty success.
  RED: swallowed error returns `[]`.

## Stage 5 — Text verification and live QA

- **5.1 `scripts/verify-text.mjs`.** Renders R3, expands it, extracts the top 20 comments
  by score from the DOM, and diffs normalized text against the fetcher's output.
- **5.2 Run.** R1/R2/R3 public route, thread matrix, contract probe, text diff. Record
  timings and counts in the findings document.
- **5.3 Findings.** Update the findings document with the matrix and measurements.

## Stage 6 — Gate and audit

- **6.1** Fetcher gate and repository gate.
- **6.2** Neutral audit subagent reviews spec, plan, diff, tests and live evidence against
  every AC; fix and re-audit until PASS.

## Definition of done

Every AC in the spec passes with committed tests or reproducible live evidence; no fixed
settle remains in the comment path; all three contract endpoints pass; the text diff is
clean; both gates are green; the auditor reports PASS.
