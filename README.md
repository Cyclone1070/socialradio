# SocialRadio Backend

AI-powered radio station backend. It scrapes Reddit for real conversations, clusters posts into topics, generates call-in talk-radio scripts with an LLM, synthesises speech with TTS, and streams the result as HLS audio per channel.

**Pipeline at a glance:**

```
Reddit → scrape (feed) → cluster (channel) → script + TTS (radio) → queue + chunk (channel) → HLS stream
```

## Feature slices

Each slice has a `README.md` describing its **behaviour** — rules, flows, and intent. Technical details live in the code.

| Slice | Purpose | Behaviour doc |
|---|---|---|
| `src/feed` | Reddit content acquisition — scraping, filtering, caching | [README](src/feed/README.md) |
| `src/channel` | User channels, station queue, HLS playback | [README](src/channel/README.md) |
| `src/radio` | Script generation + TTS voice tracks | [README](src/radio/README.md) |
| `src/media` | Music / ad / jingle library for the queue | [README](src/media/README.md) |
| `src/storage` | Object storage abstraction (S3/MinIO) | [README](src/storage/README.md) |
| `src/auth` | Login, JWT, RBAC guards | [README](src/auth/README.md) |
| `src/user` | User profile | [README](src/user/README.md) |
| `src/database` | Schema management & migrations | [README](src/database/README.md) |
| `src/domain` | Shared types & entities | [README](src/domain/README.md) |
| `src/healthcheck` | Liveness probe | [README](src/healthcheck/README.md) |
| `deployment/tests` | Blackbox E2E suite (34 cases) | [README](deployment/tests/README.md) |

## Running

```sh
cp .env.example .env    # fill in ADMIN_EMAIL / ADMIN_PASSWORD / JWT_SECRET
docker compose -f deployment/docker/docker-compose.yml up --build
```

E2E suite (spins up the full stack — Postgres, MinIO, browserless, the reddit-fetcher container, and the app — plus a test fixture):

```sh
./deployment/tests/run-docker-test.sh
```
