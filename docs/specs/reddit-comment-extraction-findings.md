# Findings: Reddit comment expansion (Stage 0)

Date: 2026-11-18. Probe: browserless + stealth Chromium, thread R1
(`r/askreddit/comments/1xuw9sz`), viewport 1280x900.

## Initial render

- 25 `shreddit-comment` elements on load, depths 0:9, 1:10, 2:6.
- Comments are nested: a depth-1 comment sits three DOM hops inside its parent
  `shreddit-comment`.
- Container: `#comment-tree` (3 top-level children, ~957 KB innerHTML after 71
  comments).

## Expansion controls

- "more replies" appears twice per branch: a `BUTTON` (inline) and an `A` link to
  `/r/.../comment/<id>/?force-legacy-sct=1` (navigates to a different page).
- Only the `BUTTON` may be used.
- Clicking the button issues `POST /svc/shreddit/more-comments/<sub>/t3_<post>?...`
  and appends ~10 comments. The URL did not change.
- 79 `faceplate-partial` elements exist, 26 comment-related, with
  `/svc/shreddit/more-comments/...` sources.

## Direct fragment fetch is not usable

- `fetch(src)` returns the full 318 KB page shell, 0 comments.
- `fetch(src + '&render-mode=partial')` returns `#shreddit-forbidden` (1.8 KB).
- Therefore the fragment URLs cannot be replayed outside the app's own click flow.

## Expansion loop prototype

- Repeatedly clicking the first "more replies" button: 25 → 369 comments in 60
  rounds / 66 seconds; 26 buttons still remained at the cap.
- Growth ~6 comments per round. 90 seconds is enough for 400+ comments.

## Parse structure

- `thingid` (e.g. `t1_19sjyabus5sub`), `author`, `score`, `created` (ISO-8601 with
  offset), `depth` attributes.
- Comment body: `[slot="comment"]` textContent; does not include nested replies.
- Parent: `element.parentElement.closest('shreddit-comment')`, null at top level.

## Decisions

- Expand by clicking `BUTTON` elements only; never `A` links.
- Read `#comment-tree` innerHTML after expansion and parse it in Node with jsdom.
- Parent comes from DOM nesting, not depth arithmetic.
- Cap default 500, budget 90 s, stale-growth stop after 3 rounds without growth.
- Browserless requires a connection lease (`?timeout=...`); the default lease killed
  a 120-second run.

## Live QA (final build)

| Thread | Returned | Rendered | Expanded | Elapsed | Max parent chain | Invalid fields | Broken parents | Sorted |
|---|---|---|---|---|---|---|---|---|
| R1 askreddit/1xuw9sz | 328 | 25 | 305 | 83.1 s | 5 | 0 | 0 | yes |
| R2 askreddit/1xtzyoo | 374 | 25 | 349 | 83.9 s | 5 | 0 | 0 | yes |
| R3 webscraping/1xys320 | 39 | 25 | 14 | 37.3 s | 5 | 0 | 0 | yes |

Probe: `reddit-fetcher/scripts/live-qa.mjs` (requires `npm run build` and a
browserless instance):

    BROWSERLESS_WS_URL=ws://localhost:4000/playwright?timeout=300000 node scripts/live-qa.mjs askreddit 1xuw9sz

Each run reports returned/rendered/expanded counts, elapsed, URL stability, `.json`
request count (main and continuation pages), max parent chain, invalid fields, broken
parents, and sort order. `--manual` adds a full primary-page expansion and compares the
observed id set with the returned set. All
three runs reported `urlSame: true`, `jsonRequests: 0`, `invalidFields: 0`,
`brokenParents: 0`, `sortedDesc: true`.

- R3 manual comparison (`--manual`): the fully expanded primary page holds 39 unique text
  comments; the collector returned those same 39 (`missingInline = 0`, `extra = 0`). The
  manual sweep also opened 20 continuation pages and found one further comment on a page
  beyond FR-13's 8-page cap, which is expected and out of the guarantee.
- Request interception on R1 observed 0 requests to a `.json` path.
- The page URL was unchanged before and after extraction on R1.
- Continuation pages: R3 exposed 18 links; at most 8 are opened per extraction, and the
  linked comment is dropped from the merged set to avoid duplication.

## Verification runs (after audit fixes)

- Fetcher gate: `npm run gate` in `reddit-fetcher` — 8 suites, 56 tests, exit 0.
- Repository gate: `npm run gate` at the root — 46 suites / 322 tests plus 7 CLI suites
  / 42 tests, exit 0.
- Route probe (public path: HTTP → `fetchPostComments` → collector):
  `scripts/route-probe.mjs` against a live fetcher returned HTTP 200 with 39 comments on
  R3 and 295 comments on R1 in 74.5 s, max parent chain 5, `schemaOk: true` on both; every
  record had the six required backend keys with the expected types
  (`author, body, created_utc, id, parent_id, score`), exit 0.
- Request interception on the R3 manual run covers the primary page and every continuation
  page it opens: `jsonRequests: 0`.
- The core-collector probe (`live-qa.mjs`) uses its own 90 s budget, so its counts (328 /
  374 / 39) are slightly higher than the public path's 80 s budget (295 on R1).
- The shared `reddit-contract.ts` still fails on `/top-posts` (out of scope) and
  therefore skips `/comments`; the route probe above is the AC-14 evidence.
- Negative scores are preserved (`comments.spec.ts`, "-7" case).
- The scraper waits up to 5 s for 25 rendered comments before collecting, so a failed
  expansion still returns at least 25 comments on a thread that renders them.
