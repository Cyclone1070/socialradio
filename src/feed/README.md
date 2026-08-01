# Feed — Reddit Content Acquisition

Acquires real Reddit conversations for the radio: fetches subreddit posts, pulls their comments, and persists only content good enough to become a radio segment.

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
fetch up to 100 top posts
  └─ keep only posts with num_comments >= 40      (cost pre-filter: needs a real conversation)
for each candidate post:
  ├─ fetch comments  (./.json?sort=top&limit=500&showmore=false)
  ├─ word-count guard: total words across ALL comments >= 2500
  └─ if it qualifies: save post + all its comments
cap: max 20 posts saved per run
```

**The comment fetch params are load-bearing** (why `sort=top&limit=500&showmore=false`):

- `showmore=false` — Reddit inserts `more` placeholder nodes for unloaded comments; they break the strict validation schema. This param removes them entirely. **Undocumented API param** — if Reddit stops honouring it, the fallback is a tolerant schema.
- `limit=500` — maximum batch Reddit serves (~500 comment nodes; higher values are clamped). `limit` counts *all* comments across all nesting depths, not just top-level.
- `sort=top` — highest-scored comments first, nested replies score-sorted too.

**Word-count guard is the quality bar**: it's what separates a segment-worthy thread from a dead one, and it feeds the script generator's 2500–3500 word budget.

### Re-scrape semantics

- **Same subreddit, second scrape**: posts already in the DB are skipped (dedupe by Reddit post ID) — no duplicates ever, only *new* posts get saved. `lastScrapedAt` refreshes on every run.
- **Invalid subreddit** (private, banned, or non-existent): the subreddit stub row is deleted and the run returns `{ "scrapedPostsCount": 0 }` — no error, a no-op.
- **Cache TTL**: posts expire after 72 hours via `DELETE /admin/feeds/cache` (also run at the start of every scrape).

### Who else triggers scrapes

The channel queue generator calls this slice directly when a subscribed subreddit is **stale** (no scrape in 72h) or **exhausted** (all its posts already played) — see `src/channel/README.md`.
