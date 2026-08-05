# Channel — Stations, Queue & HLS Playback

User-facing stations: each channel subscribes to subreddits, maintains a never-ending queue of segments (talk, songs, ads, jingles), and streams them as HLS to listeners.

## Public API

| Method | Path | Auth | Behaviour |
|---|---|---|---|
| `GET` | `/channels` | JWT | Lists channels you own, plus all **public** channels. |
| `POST` | `/channels` | JWT | Creates a channel. Body: `{ name, visibility? }` — visibility defaults to `private`. Empty name → 400. |
| `POST` | `/channels/:id/subreddits` | JWT | Subscribes the channel to a subreddit. Body: `{ subredditName }`. Non-existent channel → 404. **Idempotent**: subscribing twice is a no-op (200/201 either way). |
| `DELETE` | `/channels/:id/subreddits/:subName` | JWT | Removes the subscription. Missing channel or subreddit → 404. |
| `GET` | `/channels/:id/playlist.m3u8` | none* | Live HLS manifest for the channel. 404 if no segments exist yet. |
| `GET` | `/channels/:id/chunks/:filename` | none* | Serves the audio chunks referenced by the manifest. |
| `GET` | `/admin/channels/:id/topics` | Admin | The next pending topic for a channel (what would air next). |

\* Currently unauthenticated by design decision (see `deployment/tests/README.md` — known gap).

## Behaviour — the queue

**Buffer rule**: the queue tops itself up to **5 buffered segments** whenever it's below that.

**Cycle pattern** — every buffer refill appends one block of:

```
[1-2 Talk segments] → [1-2 Songs] → [1-2 Ads] → [1 Jingle]
```

(1 or 2 of each talk/song/ad is a 50/50 random choice.)

- **Talk segments** come from the next pending topic (see below). If no topic exists, a short ad filler is appended instead — the station never goes silent, and the short bridge means the queue drains to the next topic check faster.
- Talk is generated **asynchronously**: the segment is queued as `generating` (and the topic's posts are immediately marked *played* so nothing double-queues), voice generation runs in the background, then the segment flips to `ready` — or `failed` if generation errors.
- Songs/ads/jingles are picked uniformly at random from the media library, chunked immediately.

### When the queue rescrapes Reddit

Picking the next topic for a channel runs in two phases:

1. **Fire background scrapes (always)**: for each subscribed subreddit, check if it needs a fresh scrape: **stale** (last scrape > 72h ago) **or exhausted** (every post in the DB for that sub has already been played). If so, fire scrapes in a **sequential background chain** — sub A completes before sub B starts, never awaited, and each Reddit request is spaced 1–2s (proper request spacing, no parallel scraping). The scraper itself deduplicates (an in-flight claim, TTL-bounded) and skips subs cooling down after a 0-new-post scrape; the admin force-scrape bypasses both.
2. **Read the topic from the current DB**: unplayed posts are clustered into topics; the best cluster becomes the next talk segment — or null, and a filler is appended.

This is the *pull* path into the feed slice — scraping happens on demand (preventively refreshing the DB even while topics are available), not on a schedule.

## Behaviour — playback (the radio clock)

Every `GET /playlist.m3u8` call advances the channel's state:

- **Active polling**: the playhead advances by the time elapsed since the last request.
- **Idle ≥ 120s** (listener disconnected): fast-forward logic kicks in — short idle resumes where it left off; long idle skips to a randomized 10–20s "wrap-up" of the current segment; tiny segments are skipped entirely to the next one.
- **Segment done**: when the playhead passes a segment's end, advance to the next; consumed segments are pruned from the table (everything strictly behind the playhead); at end of queue the whole consumed set is cleared and a fresh cycle is buffered.
- **Replenishment**: if fewer than 3 segments remain after the current one, buffer ahead in the background — the caller owns the "when", the queue generator just appends a cycle.

**HLS manifest** — 10-second chunks (128kbps math: 160,000 bytes = 10s), sliding window of 3 chunks, `EXT-X-START` offsets into the current chunk for gapless-ish resume. Chunk files live at `channels/{channelId}/chunks/{segmentId}_{index}.mp3`.
