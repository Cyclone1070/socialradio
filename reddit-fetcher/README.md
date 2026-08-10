# reddit-fetcher — dedicated Reddit scraping container

Owns everything that touches Reddit in a browser: browserless config, stealth/fingerprints, per-subreddit contexts, and the **pacing queue**.

## Why it exists

The backend must scale horizontally, but Reddit traffic must stay one paced stream per IP (one container = one identity pool behind browserless's one egress IP). All backend replicas call this one container over REST; the Pacer allows up to **5 concurrent requests** with a **random 500–1000ms delay** per request, while same-subreddit requests stay strictly sequential (a browser context can only do one thing).

**Deliberately unscalable**: this container IS the pacing point. If throughput ever needs to grow, scale in (browserless + fetcher) *pairs* — each pair is one IP and one paced queue.

## API

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/top-posts/:subreddit?limit=100[&after=<cursor>]` | `{ posts, after, isInvalid }` — ONE Reddit listing page (mapped, `num_comments >= 40` pre-filter), `after` = the listing's next cursor. `after: null` = **stop signal** (pool exhausted and/or the page carried zero viable posts). `isInvalid: true` = private/banned/non-existent (page loaded, zero posts). Errors → `502`. |
| `GET` | `/comments/:subreddit/:postId` | `{ comments }` — flattened comment tree (`sort=top&limit=250&showmore=false`, prefix-stripped ids). Errors → `502`. |
| `GET` | `/exists/:subreddit` | `{ valid }` — subscribe-time validation, 1 request. |

**The fetcher is stateless**: one request = one page. The backend holds the cursor and walks page by page (it owns dedup, so the stop conditions live there). The Pacer wraps every request: **random 500–1000ms delay**, at most **5 requests in flight**, same-subreddit requests strictly sequential. Reddit's real per-request latency (~3–4s) stacks on top.

## Behaviour

- **Context affinity**: one browser context per subreddit (fresh fingerprint per sub, reused across that sub's requests, closed after 15min idle). Identity = one visitor per sub.
- **One persistent browser connection** to browserless, opened lazily.
- **No pacing inside the scraper** — the pacer wraps the HTTP handlers; all timing lives in one place.

## Run

```sh
npm install
BROWSERLESS_WS_URL=ws://browserless:3000/playwright npm start   # listens on :3001
```

## Test

```sh
npm test   # 15 cases: mocked browserless pages, fake timers for pacing
```
