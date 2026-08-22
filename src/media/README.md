# Media — Music, Ads & Jingles

The library the channel queue draws filler from: music tracks, ad breaks, and the jingle that closes every queue cycle.

## Public API

No HTTP routes. Implements `MediaContract` (`getRandomMusic`, `getRandomAd`, `getRandomJingle`) injected by `QueueService` and `PlaybackService`.

## Behaviour

- Three independent pools: **music tracks**, **ads**, **jingles** — each with its own table.
- Picks are **uniformly random** from the whole pool — no weighting, no rotation logic, no dedup guarantee (the same track can play twice in a row).
- **Empty pool → `NotFoundException`** — a station with no music can't run. Library contents are operator-managed (there is no write API).
- Random selection + the queue's random counts (1–2 per block) are what make the station feel alive rather than looped.
