# reddit-fetcher — dedicated Reddit scraping container

Owns everything that touches Reddit in a browser: browserless config, stealth/fingerprints, per-subreddit contexts, and the **global pacing queue**.

## Why it exists

The backend must scale horizontally, but Reddit traffic must stay a single paced stream (one container = one identity pool behind browserless's one egress IP). All backend replicas call this one container over REST; it serializes every request with **1–2s spacing**.

**Deliberately unscalable**: this container IS the pacing point. If throughput ever needs to grow, scale in (browserless + fetcher) *pairs* — each pair is one IP and one paced queue.

## API

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/top-posts/:subreddit?limit=100` | `{ posts, isInvalid }` — up to `limit` posts with `num_comments >= 40`. `isInvalid: true` = private/banned/non-existent (page loaded, zero posts). Errors → `502`. |
| `GET` | `/comments/:subreddit/:postId` | `{ comments }` — flattened comment tree (`sort=top&limit=500&showmore=false`, prefix-stripped ids). Errors → `502`. |
| `GET` | `/exists/:subreddit` | `{ valid }` — subscribe-time validation, 1 request. |

Every request passes through the single `Pacer`: first fires immediately, each next waits 1–2s after the previous *completes* (`floor(random*1000)+1000`).

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
npm test   # 9 cases: mocked browserless pages, fake timers for pacing
```
