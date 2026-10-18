# SocialRadio

An AI radio backend. It scrapes Reddit conversations, clusters them into topics, writes a call-in
talk-radio script, synthesizes it with a speech service, and streams each station as a live HLS
playlist — talk segments interleaved with music, ads and jingles.

```
Reddit → scrape → cluster → script → speech → queue → live HLS
```

A station with no listeners costs nothing: the playhead is a lazy virtual clock advanced by manifest
requests, and the audio is static files served from object storage.

## Layout

| Path | What it is |
|---|---|
| `src/content` | Reddit acquisition: the page walk, dedup, the word-count guard, the scrape lease |
| `src/channel` | Stations, the queue, the playhead, the HLS manifest, topic clustering |
| `src/script` | Two-stage call-in script generation (LLM) |
| `src/voice` | HTTP client for the speech service |
| `src/media` | Music, ad and jingle pools the queue draws filler from |
| `src/user` | Login, identity, roles, the boot-time admin seed |
| `src/domain` | Shared contracts and payload types — no logic |
| `src/infrastructure` | Database, storage, logging, auth guards, healthcheck, the shared claim lease |
| `reddit-fetcher/` | Sidecar: browserless, reddit browsing, the pacing queue |
| `voice-service/` | Sidecar: TTS engine, voice casting, concatenation, measured duration |
| `deployment/` | Docker compose, the Tier 1 mocks, the test suites |
| `docs/` | Architecture rules, the multi-instance audit, the script blueprint |

## Running it

```sh
cp .env.example .env      # fill in LLM_API_KEY; the rest works as-is against local docker
docker compose -f deployment/docker/docker-compose.yml up --build
```

Migrations run as their own compose service, never on app boot. Ports: app `:3000`, SeaweedFS `:9000`
(console `:9001`), browserless `:4000`, speech service `:3002`; the fetcher is reachable only inside the
compose network. A station needs rows in the music, ad and jingle tables before it sounds like anything
— with an empty library the queue still fills, but every filler points at the placeholder key
`jingles/station-id.mp3`, which nothing uploads.

## HTTP surface

| Method | Path | Auth |
|---|---|---|
| `GET` | `/healthcheck` | none |
| `POST` | `/auth/login` | none |
| `GET` | `/users/me` | JWT |
| `GET` | `/channels` | JWT |
| `POST` | `/channels` | JWT |
| `GET` | `/channels/active` | `X-Internal-Token` |
| `POST` | `/channels/:id/subreddits` | JWT |
| `GET` | `/channels/:id/subreddits` | JWT |
| `DELETE` | `/channels/:id/subreddits/:subName` | JWT |
| `GET` | `/channels/:id/live.m3u8` | none for public stations, JWT for private |
| `GET` | `/admin/channels/:id/topics` | admin |
| `POST` | `/admin/feeds/scrape` | admin |
| `GET` | `/admin/feeds/subreddits` | admin |
| `DELETE` | `/admin/feeds/cache` | admin |

There is no sign-up route: the admin account is seeded at boot from `ADMIN_EMAIL` / `ADMIN_PASSWORD`,
and that is the only account that can exist today.

## Tests

Two tiers, and they never run together.

```sh
npm run gate                                 # format + lint + tsc + unit tests
sh deployment/tests/run-docker-test.sh all   # Tier 1: the full stack against mocks
sh deployment/tests/run-contract-tests.sh    # Tier 2: one toy probe per real boundary
```

Tier 1 is black-box: the real app, database and storage, with the LLM, reddit and speech boundaries
served by the mocks in `deployment/mocks/`. Tier 2 fires a handful of small probes at the real
providers and skips loudly for whatever it cannot reach — a 429 or an unreachable reddit is
availability, not a broken contract.

## Docs

- [docs/gaps.md](docs/gaps.md) — what the product still needs, and what each gap blocks
- [docs/architecture-guidelines.md](docs/architecture-guidelines.md) — placement rules, and the guardrails `src/architecture.spec.ts` enforces
- [docs/scaling.md](docs/scaling.md) — running more than one instance: what is shared, what was fixed, the fetcher's pacing rule
- [docs/script-structure.md](docs/script-structure.md) — the four-step call-in segment and the hook rules
- [plan.md](plan.md) — the working log: what was fixed, why, and what is parked
- [docs/archive/](docs/archive/) — completed plans, kept for the reasoning
