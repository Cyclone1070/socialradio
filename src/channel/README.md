# Channel — Stations, Queue & Live Icecast Streaming

User-facing stations: each channel subscribes to subreddits, maintains a never-ending queue of segments (talk, music, ads, jingles), and streams them live via Icecast and Liquidsoap.

## Public API

| Method | Path | Auth | Behaviour |
|---|---|---|---|
| `GET` | `/channels` | JWT | Lists channels you own, plus all **public** channels. |
| `GET` | `/channels/active` | Internal Secret | Lists all active channels for streaming engine discovery (`X-Internal-Token`). |
| `POST` | `/channels` | JWT | Creates a channel. Body: `{ name, visibility? }` — visibility defaults to `private`. Empty name → 400. |
| `POST` | `/channels/:id/subreddits` | JWT | Subscribes the channel to a subreddit. Body: `{ subredditName }`. Non-existent channel → 404. **Idempotent**. |
| `GET` | `/channels/:id/subreddits` | JWT | Returns list of subreddits subscribed to by the channel. |
| `DELETE` | `/channels/:id/subreddits/:subName` | JWT | Removes the subscription. Missing channel or subreddit → 404. |
| `GET` | `/channels/:id/next-track` | Internal Secret | Returns next playable audio track for Liquidsoap stream source (`X-Internal-Token`). |
| `GET` | `/admin/channels/:id/topics` | Admin | The next pending topic for a channel (what would air next). |

## Behaviour — the queue

**Buffer rule**: the queue maintains pre-generated segments ahead of the live broadcast playhead.

**Cycle pattern** — every buffer refill appends one block of:

```
[1-2 Talk segments] → [1-2 Music tracks] → [1-2 Ads] → [1 Jingle]
```

(1 or 2 of each talk/music/ad is a 50/50 uniform random choice.)

- **Talk segments** come from the next pending topic (see below). If no topic exists, a short ad filler is appended instead.
- Talk is generated **asynchronously**: the segment is queued as `generating`, voice generation runs in the background, then the segment flips to `ready` — or `failed` if generation errors.
- Music tracks/ads/jingles are picked uniformly at random from the media library.

### When the queue rescrapes Reddit

Picking the next topic for a channel runs in two phases:

1. **Lazy 20-Sub Pool Rotation**:
   - Counts subreddits with available unplayed posts (`activeSubs`).
   - If `activeSubs.length >= 20`, **no scrapes are triggered** (the channel already has a diverse pool of playable content).
   - If `activeSubs.length < 20`, calculates `toScrapeCount = min(20, totalSubscribed) - activeSubs.length`.
   - Sorts inactive (exhausted/stale) subreddits by rotation priority: never-scraped (`lastScrapedAt === null`) first, then oldest `lastScrapedAt` ascending (least recently scraped).
   - Fires background scrapes for the top `toScrapeCount` subreddits in a **sequential background chain** (never blocking playback).
2. **Read the topic from the current DB**: unplayed posts are clustered into topics; the best cluster becomes the next talk segment — or null, and a filler is appended.

## Behaviour — playback & streaming

Liquidsoap calls `GET /channels/:id/next-track` when its stream queue needs replenishing:

- **Listener-Aware Idle Timeout**: Liquidsoap monitors Icecast listener counts. When a channel has 0 listeners for more than 10 minutes, Liquidsoap suspends `next-track` polling (saving LLM and TTS compute) and cuts to blank standby. When a listener connects, it resumes stream polling from where the playhead was left off.
- **Replenishment**: If fewer than 4 segments remain after the current one, `bufferAhead` is triggered in the background.
- **Pruning**: Consumed segments older than 100 positions behind the playhead are pruned from the database.
