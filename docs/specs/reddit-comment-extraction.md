# Spec: robust Reddit comment extraction from a rendered thread

Status: draft for implementation
Owner: `reddit-fetcher`
Supersedes: none
Related: `docs/architecture-guidelines.md`, `deployment/tests/contracts/reddit-contract.ts`

## 1. Context

Reddit's anonymous `.json` endpoints return 403 and its plain-HTTP HTML is an empty
shell that the client renders. The only working read path is a rendered page. The
current `RedditScraper.fetchPostComments` opens the rendered thread, ignores it, and
calls `./.json?sort=top&limit=500&showmore=false`, which now always fails.

Rendering introduces mechanics the old JSON path did not have:

- Only the first slice of the comment tree is in the DOM on load.
- Deeper replies are behind "more replies" controls that load inline.
- "Continue this thread" loads a different page.
- Comment fragments are also fetchable as partial HTML from `faceplate-partial`
  elements already present in the DOM.

A naive scraper returns roughly the first rendered slice and silently claims success.

## 2. Goal

`RedditScraper.fetchPostComments(subredditName, postRedditId)` returns a deduplicated,
score-ordered list of the thread's highest-scoring text comments, gathered by inline
expansion plus a bounded set of continuation pages, without any `.json` request. Ordering
is deterministic; the number of comments collected depends on the time budget and
Reddit's expansion behavior.

## 3. Definitions

- **Rendered comment** — a `shreddit-comment` element in the live DOM.
- **Inline expansion** — clicking a "more replies" button to load more comments into the
  current thread page without a URL change.
- **Continuation page** — the page opened by a "continue this thread" link, showing one
  comment as its root. Fetched in a separate page (FR-13), never by navigating the
  primary page.
- **Rejected approach** — fetching `faceplate-partial` comment URLs directly. Probed and
  rejected: without `render-mode=partial` they return the page shell, with it they return
  `#shreddit-forbidden` (findings section "Direct fragment fetch is not usable").
- **Cap** — maximum number of comments returned by one call. Default 500.

## 4. Functional requirements

- **FR-1 — Source of truth is the rendered DOM.** Every returned comment originates from
  a `shreddit-comment` element, either in the primary page or in a continuation page. No
  comment may come from a JSON endpoint.
- **FR-2 — Field mapping.** For each comment element:
  - `id`: `thingid` attribute with any `t1_` prefix removed.
  - `author`: `author` attribute.
  - `score`: `score` attribute parsed as an integer (negative values are valid);
    absent or unparseable means 0.
  - `created_utc`: `created` attribute parsed as an ISO-8601 timestamp into epoch
    seconds; absent or unparseable means 0.
  - `body`: the element's comment text, whitespace-collapsed and trimmed.
  - `parent_id`: derived per FR-3.
- **FR-3 — Parent derivation.** `parent_id` is the `thingid` of the nearest ancestor
  `shreddit-comment` element in the DOM; a top-level comment's parent is the post id.
  Depth attributes are not used for parentage. When a parent is dropped as invalid or
  cut by the cap, its children are reparented to the post id so AC-4 always holds.
- **FR-4 — Primary page never navigates.** Extraction must not change the thread page
  URL and must not follow "continue this thread" links on it. Clicking "more replies" is
  allowed only if it does not navigate.
- **FR-5 — No JSON.** No request whose path ends in `.json` may be issued during
  extraction.
- **FR-6 — Deduplication.** Comments are unique by `id`; the first occurrence wins.
- **FR-7 — Ordering.** Returned list is sorted by `score` descending, then `created_utc`
  descending, then `id` ascending. Ordering is stable across runs.
- **FR-8 — Cap.** Extraction stops when the cap is reached. The returned array never
  exceeds the cap.
- **FR-9 — Degradation.** If any expansion click or re-read fails, return the comments
  already collected. A thread that rendered at least one comment never throws.
- **FR-10 — Empty thread.** A thread with zero rendered comments returns an empty array,
  not an error.
- **FR-11 — Bounded time.** Extraction uses an 80-second collection budget. The
  unbounded operations `newPage` and `evaluate` are capped at 10 seconds; navigation is
  capped at 30 s, selector waits at 15 s / 10 s / 5 s. A dead-browser reconnect may
  retry the extraction once, so AC-8's 90-second bound applies to a healthy connection; a
  reconnect can double the wall time. Returns what was collected.
- **FR-12 — Text only.** Comments whose body is empty after trimming are excluded, as
  are comments with an empty author or a non-positive `created_utc`.
- **FR-13 — Continuation pages.** Deeper chains that only exist behind "continue this
  thread" links are collected by opening each link in a separate page, expanding it
  inline, and merging its comments. The linked comment already exists in the main tree
  and is not duplicated. At most 8 continuation pages are opened, and only while the
  time budget allows; a failed continuation never fails the extraction.

## 5. Non-functional requirements

- **NFR-1 — Deterministic ordering.** For a given set of collected comments, ordering is
  fully determined. The set itself is bounded by the time budget and Reddit's expansion
  behavior, so repeated runs may collect different amounts.
- **NFR-2 — Minimal new dependencies.** Use the existing Playwright/stealth stack. One
  HTML parser (`jsdom`) is permitted so DOM parsing runs in Node and is unit testable; no
  other runtime dependency may be added.
- **NFR-3 — Public surface unchanged.** `fetchPostComments` keeps its signature and
  returns `RedditCommentData[]`; `app.ts` routes and DTOs do not change.
- **NFR-4 — Observability.** One info log line per extraction with: rendered count,
  expanded count, returned count, elapsed milliseconds.

## 6. Acceptance criteria

Each criterion states how it is verified. `R1`, `R2`, `R3` are the reference threads in
section 7.

- **AC-1 — Coverage on a large thread.** On `R1`, one call returns at least 200 unique
  comments. Verified by live QA (section 8).
- **AC-2 — Completeness on a small thread.** On `R3`, every text comment observed in the
  fully expanded **primary page** is present in the result (`missingInline = 0`), provided
  that observed set has at most 80 entries. The result may also contain comments from
  continuation pages, which FR-13 bounds. Verified by live QA with `--manual`.
- **AC-3 — Field validity.** Every returned comment has a non-empty `id`, non-empty
  `body`, non-empty `author`, integer `score` (negative allowed), integer `created_utc` > 0,
  and non-empty `parent_id`. Verified by unit test and live QA.
- **AC-4 — Tree integrity.** Every `parent_id` equals the post id or the `id` of another
  returned comment. Verified by unit test and live QA.
- **AC-5 — No duplicates.** No two returned comments share an `id`. Verified by unit
  test and live QA.
- **AC-6 — No navigation of the primary page.** `page.url()` after extraction equals the
  thread URL before extraction. The primary page receives exactly one navigation (the
  initial `goto`); continuation pages are separate pages. Verified by live QA and by an
  integration test asserting one `goto`.
- **AC-7 — No JSON.** A request-interception probe observes zero requests to paths
  ending in `.json` during extraction. Verified by live QA.
- **AC-8 — Time bound on a large thread.** On `R1`, `fetchPostComments` returns in at
  most 90 seconds measured from call start. Verified by live QA.
- **AC-9 — Degradation.** With expansion clicks forced to fail after at least 25
  comments have rendered, one call still returns at least 25 comments and does not throw.
  The scraper waits for a stable tree (250 ms quiet window, 3 s cap) before collecting.
  Verified by unit test.
- **AC-10 — Empty thread.** A thread with no rendered comments returns `[]` and does not
  throw. Verified by unit test.
- **AC-11 — Ordering.** The first returned comment has the maximum score in the result;
  the sequence is non-increasing by score, with the FR-7 tie-breakers. Verified by unit
  test with hand-written scores.
- **AC-12 — Cap.** With cap 50 on a thread that has more than 50 valid comments, exactly
  50 are returned. Verified by unit test.
- **AC-13 — Gate.** `npm run gate` in `reddit-fetcher` and the repository-wide gate pass
  with no failures. Verified by command output.
- **AC-15 — Deep chains.** On `R2`, the returned comments include a parent chain of at
  least five comments (five distinct ids ending at the post). Verified by live QA.
- **AC-14 — Comments route contract.** A live fetcher's
  `/comments/:subreddit/:postId` returns a non-empty list whose records match the
  backend schema. The shared `reddit-contract.ts` still fails on `/top-posts`, which is
  out of scope for this spec and covered separately. Verified by a direct probe.

## 7. Reference threads

- **R1 — large.** `https://www.reddit.com/r/askreddit/comments/1xuw9sz/` — post reports
  1,729 comments at the time of writing.
- **R2 — deep.** A thread with at least five nesting levels, selected during
  investigation and recorded in the findings document.
- **R3 — small.** A thread with 30–80 comments, selected during investigation and
  recorded in the findings document.

## 8. Verification plan

1. **Unit tests** (jest) cover FR-2, FR-3, FR-6, FR-7, FR-8, FR-9, FR-10, FR-12 and
   AC-3..AC-6, AC-9..AC-12 with hand-written fixtures. No test may assert on a mock's
   own behavior.
2. **Live QA** uses a standalone Playwright probe against R1, R2, R3 that records:
   initial rendered count, final returned count, elapsed time, page URL before/after,
   request log filtered for `.json`, and the first three returned comments.
3. **Audit** is performed by a neutral subagent that reads this spec, the plan, the
   diff, and the QA output, and checks each AC individually.

## 9. Out of scope

- `fetchTopPosts` and `exists` still use `.json` and are covered by a separate spec.
- Media, awards, flair, and subreddit metadata.
- Comments beyond the cap, and any pagination that requires deep navigation.
- Retry/backoff policy for the fetcher's HTTP callers.

## 10. Known risks

- Reddit can change attribute names or fragment mechanics without notice.
- Expansion endpoints may require a CSRF token or a cursor that only exists after a
  click; if so, the plan must record the fallback and the spec's AC-1 threshold must be
  re-confirmed before coding.
- Rate limiting may make R1 slow. On a healthy connection the 80-second budget plus the
  10-second caps on `newPage`/`evaluate` keeps a call at approximately 90 seconds; a
  dead-browser reconnect deliberately retries once and can double that.
