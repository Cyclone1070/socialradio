# Feed — Reddit Content Acquisition

Acquires real Reddit conversations for the radio: fetches subreddit posts, pulls their comments, and persists only content good enough to become a radio segment. **Browsing happens in the `reddit-fetcher` container** (owns browserless, per-subreddit contexts, and the global pacing queue) — the backend calls it over REST.

## Public API

All routes admin-only (`JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`).

| Method | Path | Behaviour |
|---|---|---|
| `POST` | `/admin/feeds/scrape` | Scrapes a subreddit now. Body: `{ "subredditName": "AskReddit" }`. Returns `{ "scrapedPostsCount": n }` — posts actually saved this run (0 if nothing qualified). |
| `GET` | `/admin/feeds/subreddits` | All known subreddits with `lastScrapedAt` and current `postCount` in the DB. |
| `DELETE` | `/admin/feeds/cache` | Purges posts older than 72 hours (comments cascade). |

## Behaviour — the scrape pipeline

For one subreddit, one scrape run does:

```
fetch up to 100 top posts   (reddit-fetcher:  GET /top-posts/:r?limit=100 → { posts, isInvalid })
  └─ keep only posts with num_comments >= 40      (cost pre-filter: needs a real conversation)
    isInvalid (private/banned/non-existent) → delete subreddit row, return {0} (no separate validation load)
for each candidate post:
  ├─ fetch comments  (reddit-fetcher: GET /comments/:r/:postId → { comments })
  ├─ word-count guard: total words across ALL comments >= 2500
  └─ if it qualifies: save post + all its comments
cap: max 20 posts saved per run
```

**The comment fetch params are load-bearing** (why `sort=top&limit=250&showmore=false`):

- `showmore=false` — Reddit inserts `more` placeholder nodes for unloaded comments; they break the strict validation schema. This param removes them entirely. **Undocumented API param** — if Reddit stops honouring it, the fallback is a tolerant schema.
- `limit=250` — measured sweet spot: median ~8.1k words on top AskReddit posts (3.2× the 2500-word guard) at a fraction of the 500-limit's 1.2MB payload. Larger limits buy zero extra yield — posts that miss the guard at 250 miss it at 500 too, their threads simply don't add up.
- `sort=top` — highest-scored comments first, nested replies score-sorted too.

Fetches use the page's in-page `fetch` against the `.json` endpoint: Reddit 403s direct document navigation to `.json` URLs (anti-bot), so a full page load + in-page fetch is the only working shape. No `shreddit-post` selector wait — the `.json` status IS the page-real signal (leftover from the DOM-scraping era; cost 2.5–15s/request). 404 = truly dead (`isInvalid`); 403/429 and navigation races get bounded retries (750ms backoff in-page, 500ms for destroyed navigation contexts).
- `sort=top` — highest-scored comments first, nested replies score-sorted too.

These params live in `reddit-fetcher/src/scraper.ts` — **the fetcher is the single owner of Reddit browsing behaviour**, plus:

- per-subreddit **context affinity** (one fingerprint/cookie identity per sub, reused across that sub's requests)
- the **global pacing queue**: every request through one container, serialised with no artificial gap — safe with any number of backend replicas
- `GET /exists/:r` for subscribe-time validation (`validateSubreddit`, 1 request)

**Word-count guard is the quality bar**: it's what separates a segment-worthy thread from a dead one, and it feeds the script generator's 2500–3500 word budget.

### Re-scrape semantics

- **Same subreddit, second scrape**: posts already in the DB are skipped (dedupe by Reddit post ID) — no duplicates ever, only *new* posts get saved. `lastScrapedAt` refreshes on every run.
- **Invalid subreddit** (private, banned, or non-existent): the fetcher marks the feed `isInvalid`; the subreddit stub row is deleted and the run returns `{ "scrapedPostsCount": 0 }` — no error, a no-op. Same signal powers subscribe-time validation via `GET /exists/:r`.
- **Cache TTL**: posts expire after 72 hours via `DELETE /admin/feeds/cache` (also run at the end of every scrape, per-sub, AFTER saving new posts).

### Who else triggers scrapes

The channel queue generator calls this slice directly when a subscribed subreddit is **stale** (no scrape in 72h) or **exhausted** (all its posts already played) — see `src/channel/README.md`.
