# Plan: robust Reddit comment extraction

Implements `docs/specs/reddit-comment-extraction.md`.
Method: investigation first, then strict TDD cycles. No production code before a
failing test.

## Stages

### Stage 0 — Investigation (no production code)

Goal: learn the real mechanics so the algorithm is built on evidence, not guesses.

- **0.1 Initial render.** On R1, record: number of `shreddit-comment` elements on load,
  their depth distribution, the comment tree container, and whether nested comments are
  DOM children of their parent.
- **0.2 Partial inventory.** List every `faceplate-partial` in the thread DOM: `name`,
  `loading`, `src`, and any `input[name=cursor]`. Identify which ones carry comments.
- **0.3 Fragment fetch.** From inside the page, `fetch(partial.src)` and inspect the
  response: status, length, number of `shreddit-comment`, depth values, and whether it
  contains further partials. Record whether a CSRF token or POST is required.
- **0.4 Expansion loop prototype.** Throwaway script: repeatedly fetch discovered
  partials until exhausted or capped; record unique comment count and elapsed time on
  R1. Do the same on R2 (deep) and R3 (small).
- **0.5 Navigation check.** Confirm what "continue this thread" does to the URL, and
  confirm "more replies" expands without navigation. Record the exact selectors.
- **0.6 Findings document.** Write `docs/specs/reddit-comment-extraction-findings.md`
  with counts, selectors, timings, and the chosen strategy. (Historical: the fragment
  strategy described in 0.2-0.4 was probed and rejected; the findings document records
  why, and later stages use click-based expansion.)

Gate: if AC-1 (>= 200 comments on R1) is proven infeasible, stop and amend the spec
before any production code.

### Stage 1 — Parsing (TDD)

New module `reddit-fetcher/src/comments.ts`, tests in `comments.spec.ts`.

- **1.1 `parseCommentTree(html)`** — parse an HTML string with jsdom and return raw
  records in document order, with parents taken from DOM nesting (no depth offsets;
  fragments are not fetched). RED: module/function missing.
- **1.2 `toRedditComment(raw, postId)`** — normalize: strip `t1_`, parse score, parse ISO
  timestamp to epoch seconds, collapse whitespace, default invalid values.
  RED: normalization missing; assert hand-written literals.
- **1.3 `finalizeComments(comments, cap, postId)`** — dedupe by id, drop empty bodies and
  invalid authors/timestamps, sort by score/created/id, apply the cap, and reparent
  comments whose parent was dropped or cut to the post id.
  RED: duplicates, unsorted output, or orphaned parents survive.

### Stage 2 — Expansion orchestration (TDD)

New module `reddit-fetcher/src/comment-collection.ts`, tests in
`comment-collection.spec.ts`. The page is injected as a minimal interface so tests use a
scripted fake, not a browser.

- **2.1 No expansion control** — returns the parsed rendered comments.
  RED: returns [] because expansion is unimplemented.
- **2.2 Click to expand** — clicks the first inline "more replies" button, re-reads the
  tree, and repeats until the control disappears or growth stalls. Fragment URLs are not
  fetched: they return the page shell or a forbidden partial (see findings).
  RED: only the first rendered slice is returned.
- **2.3 Cap** — stops expanding once the cap is reached.
  RED: exceeds cap.
- **2.4 Degradation** — a failed click or re-read returns what was collected and does not
  throw; a failed initial read returns an empty result.
  RED: throws.
- **2.5 Budget** — stops when the 80-second collection budget expires.
  RED: ignores the deadline.
- **2.6 No navigation of the primary page** — the primary page gets exactly one `goto`;
  inline clicks never change the URL.
  RED: orchestration navigates the primary page.
- **2.7 Continuations** — deep chains behind "continue this thread" links are opened in
  separate pages, expanded, and merged; the linked comment is not duplicated; at most 8
  pages and only within the remaining budget.
  RED: comments below the inline depth ceiling are absent.

### Stage 3 — Scraper integration (TDD)

- **3.1 `fetchPostComments` delegates to the collector**; the `.json` fetch is removed.
  Update the existing spec that asserts the `.json` URL.
  RED: existing test still expects `./.json?...` and fails against the new code path.
- **3.2 Observability** — one info log line with rendered, expanded, returned, elapsed.
  RED: no log call.

### Stage 4 — Live QA

- **4.1** Run `scripts/live-qa.mjs` against R1, R2, R3 (add `--manual` for the primary-page
  set comparison) and `scripts/route-probe.mjs` against a running fetcher for the public
  HTTP path. Record counts, timing, URL before/after, `.json` request count on the primary
  and continuation pages, max parent chain, and first three comments.
- **4.2** Verify AC-1, AC-2, AC-3, AC-4, AC-6, AC-7, AC-8 against the probe output.
- **4.3** Record results in the findings document.

### Stage 5 — Gate and audit

- **5.1** `npm run gate` in `reddit-fetcher`; repository-wide gate.
- **5.2** Neutral audit subagent reviews spec, plan, diff, tests, and QA evidence
  against each AC. Fix findings, re-audit until clean.

## Definition of done

- Every AC in the spec is verified with named evidence.
- All tests written test-first and watched fail for the expected reason.
- `reddit-fetcher` gate green; repository gate green.
- Findings document records the live numbers.
- Neutral audit reports no unmet AC and no untested production behavior.
