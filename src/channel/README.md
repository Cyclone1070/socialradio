# Channel — Stations, Queue & Live Icecast Streaming

User-facing stations: each channel subscribes to subreddits, maintains a never-ending queue of segments (talk, songs, ads, jingles), and streams them live via Icecast and Liquidsoap.

## Public API

| Method | Path | Auth | Behaviour |
|---|---|---|---|
| `GET` | `/channels` | JWT | Lists channels you own, plus all **public** channels. |
| `GET` | `/channels/active` | Internal Secret | Lists all active channels for streaming engine discovery (`X-Internal-Token`). |
| `POST` | `/channels` | JWT | Creates a channel. Body: `{ name, visibility? }` — visibility defaults to `private`. Empty name → 400. |
| `POST` | `/channels/:id/subreddits` | JWT | Subscribes the channel to a subreddit. Body: `{ subredditName }`. Non-existent channel → 404. **Idempotent**. |
| `DELETE` | `/channels/:id/subreddits/:subName` | JWT | Removes the subscription. Missing channel or subreddit → 404. |
| `GET` | `/channels/:id/next-track` | Internal Secret | Returns next playable audio track for Liquidsoap stream source (`X-Internal-Token`). |
| `GET` | `/admin/channels/:id/topics` | Admin | The next pending topic for a channel (what would air next). |

## Behaviour — the queue

**Buffer rule**: the queue maintains pre-generated segments ahead of the live broadcast playhead.

**Cycle pattern** — every buffer refill appends one block of:

```
[1-2 Talk segments] → [1-2 Music tracks] → [1-2 Ads] → [1 Jingle]
```

(1 or 2 of each talk/song/ad is a 50/50 uniform random choice.)

- **Talk segments** come from the next pending topic (see below). If no topic exists, a short ad filler is appended instead.
- Talk is generated **asynchronously**: the segment is queued as `generating`, voice generation runs in the background, then the segment flips to `ready` — or `failed` if generation errors.
- Songs/ads/jingles are picked uniformly at random from the media library.

### When the queue rescrapes Reddit

Picking the next topic for a channel runs in two phases:

1. **Fire background scrapes (always)**: for each subscribed subreddit, check if it needs a fresh scrape: **stale** (last scrape > 7 days ago) **or exhausted** (every post in the DB for that sub has already been played). If so, fire scrapes in a **sequential background chain** (sub A completes before sub B starts, never awaited).
2. **Read the topic from the current DB**: unplayed posts are clustered into topics; the best cluster becomes the next talk segment — or null, and a filler is appended.

## Behaviour — playback & streaming

Liquidsoap calls `GET /channels/:id/next-track` when its stream queue needs replenishing:

- **Listener-Aware Dormancy**: Liquidsoap monitors Icecast listener counts. When a channel has 0 listeners for more than 10 minutes, Liquidsoap suspends `next-track` polling (saving LLM and TTS compute). When a listener connects, it resumes stream polling from where the playhead was left off.
- **Replenishment**: If fewer than 4 segments remain after the current one, `bufferAhead` is triggered in the background.
- **Pruning**: Consumed segments older than 100 positions behind the playhead are pruned from the database.
