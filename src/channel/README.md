# Channel — Stations, Queue & Live Native HLS Streaming

User-facing stations: each channel subscribes to subreddits, maintains a never-ending queue of segments (talk, music, ads, jingles), and streams them live via RFC 8216 Native HLS.

## Public API

| Method | Path | Auth | Behaviour |
|---|---|---|---|
| `GET` | `/channels` | JWT | Lists channels you own, plus all **public** channels. |
| `GET` | `/channels/active` | Internal Secret | Lists all active channels for system discovery (`X-Internal-Token`). |
| `POST` | `/channels` | JWT | Creates a channel. Body: `{ name, visibility? }` — visibility defaults to `private`. Empty name → 400. |
| `POST` | `/channels/:id/subreddits` | JWT | Subscribes the channel to a subreddit. Body: `{ subredditName }`. Non-existent channel → 404. **Idempotent**. |
| `GET` | `/channels/:id/subreddits` | JWT | Returns list of subreddits subscribed to by the channel. |
| `DELETE` | `/channels/:id/subreddits/:subName` | JWT | Removes the subscription. Missing channel or subreddit → 404. |
| `GET` | `/channels/:id/live.m3u8` | Public / Optional JWT | Returns dynamic RFC 8216 HLS sliding-window live playlist. Public channels allow unauthenticated access; private channels require owner/admin token. |
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

## Behaviour — playback & streaming (Lazy Virtual Clock)

When listeners request `GET /channels/:id/live.m3u8`:

- **Lazy Virtual Clock**: The segment playhead advances purely on-demand based on elapsed wall-clock time between requests. No persistent background audio worker processes or daemons run when idle.
- **CDN Edge Caching**: Manifests return `Cache-Control: public, max-age=2, s-maxage=2`. Standard CDN origin-shielding and request collapsing guarantees a maximum origin poll rate of $\le 0.5$ req/s per active channel regardless of listener count.
- **Idle Freeze & Wakeup**: When no manifest requests arrive for $> 10$ minutes, the playhead freezes at the 10-minute boundary. Subsequent listener requests resume playback seamlessly from where it paused with zero skipped audio.
- **Low Runway Replenishment**: If fewer than 4 segments remain ahead of the current playhead, `bufferAhead` is triggered asynchronously in the background.
- **Sliding Window**: Returns a 6-segment sliding window `#EXTM3U` playlist with strictly monotonic `#EXT-X-MEDIA-SEQUENCE`.
- **Pruning**: Consumed segments older than 100 positions behind the playhead are pruned from the database.
